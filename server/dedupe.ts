import crypto from "node:crypto";
import { GeneratedPost, PreferredSourceName, SourceExtraction, TrendCandidate } from "./types";

type ExistingPost = {
  id?: string | number;
  topic?: string;
  headline?: string;
  sourceUrls?: string[];
  source_urls?: string[];
  headlineHash?: string;
  headline_hash?: string;
  canonicalKey?: string;
  canonical_key?: string;
  storyFingerprint?: GeneratedPost["storyFingerprint"];
  story_fingerprint?: GeneratedPost["storyFingerprint"];
  credits?: Array<{ articleUrl?: string; sourceName?: string }>;
};

const STOPWORDS = new Set([
  "about",
  "after",
  "amid",
  "into",
  "from",
  "with",
  "that",
  "this",
  "their",
  "there",
  "over",
  "under",
  "says",
  "said",
  "report",
  "reports",
  "will",
  "more",
  "than",
  "they",
  "have",
  "has",
  "been",
]);

function stableHash(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function normalizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref|output)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeHeadline(headline: string) {
  return headline
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .join(" ")
    .trim();
}

export function headlineHash(headline: string) {
  return stableHash(normalizeHeadline(headline));
}

function tokenize(text: string) {
  return normalizeHeadline(text)
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

function simhash(tokens: string[]) {
  const vector = Array.from({ length: 64 }, () => 0);
  for (const token of tokens) {
    const hash = crypto.createHash("sha256").update(token).digest();
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      const byte = hash[byteIndex];
      for (let bit = 0; bit < 8; bit += 1) {
        const index = byteIndex * 8 + bit;
        vector[index] += byte & (1 << bit) ? 1 : -1;
      }
    }
  }

  let fingerprint = 0n;
  for (let index = 0; index < vector.length; index += 1) {
    if (vector[index] > 0) {
      fingerprint |= 1n << BigInt(index);
    }
  }
  return fingerprint.toString(16).padStart(16, "0");
}

function hammingDistance(a?: string, b?: string) {
  if (!a || !b) return 64;
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

function extractKeyEntities(text: string) {
  const matches = text.match(/\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\b/g) ?? [];
  return [...new Set(matches.map((match) => match.trim()).filter((match) => match.length > 2))].slice(0, 12);
}

function getExistingFingerprint(post: ExistingPost) {
  return post.storyFingerprint ?? post.story_fingerprint;
}

function getExistingSourceUrls(post: ExistingPost) {
  const urls = post.sourceUrls ?? post.source_urls ?? [];
  const creditUrls = post.credits?.map((credit) => credit.articleUrl).filter(Boolean) as string[] | undefined;
  return [...new Set([...(urls ?? []), ...(creditUrls ?? [])].map(normalizeUrl))];
}

export function buildStoryFingerprint(topic: TrendCandidate, sources: SourceExtraction[], headline?: string) {
  const sourceUrls = [...new Set(sources.map((source) => normalizeUrl(source.canonicalUrl || source.articleUrl)))];
  const sourceNames = [...new Set(sources.map((source) => source.sourceName))] as PreferredSourceName[];
  const normalizedTitle = normalizeHeadline(headline || topic.topic);
  const keyEntities = extractKeyEntities(
    [
      headline,
      topic.topic,
      ...topic.sampleHeadlines,
      ...sources.map((source) => source.headline),
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    canonicalKey: stableHash(`${normalizedTitle}|${sourceUrls.slice().sort().join("|")}`),
    headlineHash: headlineHash(headline || topic.topic),
    sourceUrls,
    storyFingerprint: {
      normalizedTitle,
      sourceUrls,
      sourceNames,
      keyEntities,
      simhash: simhash([...tokenize(normalizedTitle), ...keyEntities.map((entity) => entity.toLowerCase())]),
    },
  };
}

export function findDuplicateStory(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  existingPosts: ExistingPost[],
  headline?: string,
) {
  const candidate = buildStoryFingerprint(topic, sources, headline);
  const candidateTokens = tokenize(candidate.storyFingerprint.normalizedTitle);
  const candidateEntities = candidate.storyFingerprint.keyEntities.map((entity) => entity.toLowerCase());

  for (const post of existingPosts) {
    const existingFingerprint = getExistingFingerprint(post);
    const existingTitle = existingFingerprint?.normalizedTitle || normalizeHeadline(post.headline || post.topic || "");
    const existingTokens = tokenize(existingTitle);
    const existingEntities = (existingFingerprint?.keyEntities ?? extractKeyEntities(post.headline || post.topic || ""))
      .map((entity) => entity.toLowerCase());
    const existingSourceUrls = getExistingSourceUrls(post);
    const sharedSourceUrl = candidate.sourceUrls.find((url) => existingSourceUrls.includes(url));
    const titleSimilarity = jaccard(candidateTokens, existingTokens);
    const entityOverlap = candidateEntities.length && existingEntities.length
      ? candidateEntities.filter((entity) => existingEntities.includes(entity)).length /
        Math.min(candidateEntities.length, existingEntities.length)
      : 0;
    const distance = hammingDistance(candidate.storyFingerprint.simhash, existingFingerprint?.simhash);

    if (sharedSourceUrl) {
      return { post, reason: "same source URL already used recently", fingerprint: candidate };
    }
    if ((post.headlineHash ?? post.headline_hash) === candidate.headlineHash) {
      return { post, reason: "same normalized headline hash", fingerprint: candidate };
    }
    if (titleSimilarity >= 0.72) {
      return { post, reason: `headline similarity ${(titleSimilarity * 100).toFixed(0)}%`, fingerprint: candidate };
    }
    if (distance <= 8 && entityOverlap > 0) {
      return { post, reason: "near-identical story fingerprint", fingerprint: candidate };
    }
    if (entityOverlap >= 0.66 && titleSimilarity >= 0.45) {
      return { post, reason: "same major entities and event framing", fingerprint: candidate };
    }
  }

  return null;
}
