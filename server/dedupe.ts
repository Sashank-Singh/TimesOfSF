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
  credits?: unknown;
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
      // `utm_` is a prefix, not a whole key — anchoring it with $ meant utm_source,
      // utm_campaign etc. were never stripped, so the same article arriving with and
      // without tracking looked like two different URLs to the dedupe check.
      if (/^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|output)$/i.test(key)) {
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

/** Matching tokens from the start until the first mismatch (order-sensitive). */
function longestCommonPrefixTokenLength(a: string[], b: string[]) {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

/** Jaccard on the first `maxTokens` headline tokens (catches wire rewrites that only change the tail). */
function prefixTokenJaccard(a: string[], b: string[], maxTokens: number) {
  const pa = a.slice(0, maxTokens);
  const pb = b.slice(0, maxTokens);
  return jaccard(pa, pb);
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

/** JSONB / drivers sometimes yield arrays, stringified JSON, or malformed objects. */
function asUrlArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === "string");
  return [];
}

function asCreditsForDedupe(raw: unknown): Array<{ articleUrl?: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Array<{ articleUrl?: string }>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Array<{ articleUrl?: string }>) : [];
    } catch {
      return [];
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ("articleUrl" in o || "article_url" in o) {
      const url = (o.articleUrl ?? o.article_url) as string | undefined;
      return url ? [{ articleUrl: url }] : [];
    }
  }
  return [];
}

function getExistingSourceUrls(post: ExistingPost) {
  const urls = asUrlArray(post.sourceUrls ?? post.source_urls);
  const credits = asCreditsForDedupe(post.credits);
  const creditUrls = credits.map((c) => c.articleUrl).filter((u): u is string => Boolean(u));
  return [...new Set([...urls, ...creditUrls].map(normalizeUrl))];
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
  // The pipeline corroborates a story with many wire/outlet sources, and those
  // corroborating URLs routinely overlap with older posts. Only a reused PRIMARY
  // source URL means the exact same story was already filed; a shared corroborating
  // URL alone would wrongly block fresh stories. True re-publishes are still caught
  // by the headline-hash / similarity / entity checks below.
  const primaryUrl = topic.primarySource?.articleUrl ? normalizeUrl(topic.primarySource.articleUrl) : null;

  for (const post of existingPosts) {
    const existingFingerprint = getExistingFingerprint(post);
    const existingTitle = existingFingerprint?.normalizedTitle || normalizeHeadline(post.headline || post.topic || "");
    const existingTokens = tokenize(existingTitle);
    const existingEntities = (existingFingerprint?.keyEntities ?? extractKeyEntities(post.headline || post.topic || ""))
      .map((entity) => entity.toLowerCase());
    const existingSourceUrls = getExistingSourceUrls(post);
    const sharedSourceUrl = candidate.sourceUrls.find((url) => existingSourceUrls.includes(url));
    const sharedPrimary = primaryUrl && existingSourceUrls.includes(primaryUrl);
    const titleSimilarity = jaccard(candidateTokens, existingTokens);
    const prefixSim = prefixTokenJaccard(candidateTokens, existingTokens, 12);
    const lcpLen = longestCommonPrefixTokenLength(candidateTokens, existingTokens);
    const minLen = Math.min(candidateTokens.length, existingTokens.length);
    const longSharedPrefix =
      minLen >= 6 && lcpLen >= Math.min(6, Math.floor(minLen * 0.65)) && titleSimilarity >= 0.55;
    const entityOverlap = candidateEntities.length && existingEntities.length
      ? candidateEntities.filter((entity) => existingEntities.includes(entity)).length /
        Math.min(candidateEntities.length, existingEntities.length)
      : 0;
    const distance = hammingDistance(candidate.storyFingerprint.simhash, existingFingerprint?.simhash);

    // Same exact article already used as a primary source -> duplicate.
    // When no primary is set (manual URL ingest / events digest), any shared source
    // URL is treated as a duplicate, preserving the old strict behaviour for those flows.
    if (sharedPrimary || (!primaryUrl && sharedSourceUrl)) {
      return { post, reason: "same source URL already used recently", fingerprint: candidate };
    }
    if ((post.headlineHash ?? post.headline_hash) === candidate.headlineHash) {
      return { post, reason: "same normalized headline hash", fingerprint: candidate };
    }
    // Full-headline Jaccard: 0.63 catches same story with a different last word or two (e.g. wire rewrites).
    if (titleSimilarity >= 0.63) {
      return { post, reason: `headline similarity ${(titleSimilarity * 100).toFixed(0)}%`, fingerprint: candidate };
    }
    if (prefixSim >= 0.78 && minLen >= 5) {
      return { post, reason: `headline prefix similarity ${(prefixSim * 100).toFixed(0)}%`, fingerprint: candidate };
    }
    if (longSharedPrefix) {
      return {
        post,
        reason: `long shared headline prefix (${lcpLen} tokens) with ${(titleSimilarity * 100).toFixed(0)}% token overlap`,
        fingerprint: candidate,
      };
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
