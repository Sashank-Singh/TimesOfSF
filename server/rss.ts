import { XMLParser } from "fast-xml-parser";
import { config } from "./config";
import { PreferredSourceName, SourceSearchResult, TrendCandidate } from "./types";
import { getSourceAliases, SOURCE_FEEDS, TREND_FEEDS, withSourceMetadata } from "./sourceRegistry";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  enclosure?: { "@_url"?: string; "@_type"?: string };
  "media:content"?: unknown;
  "media:thumbnail"?: unknown;
}

function extractImgSrcFromHtml(html: string): string | undefined {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const u = m?.[1]?.trim();
  return u?.startsWith("http") ? u : undefined;
}

function extractUrlFromUnknown(obj: unknown): string | undefined {
  if (!obj) return undefined;
  if (typeof obj === "string" && obj.startsWith("http")) return obj;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const hit = extractUrlFromUnknown(x);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    const direct = o["@_url"];
    if (typeof direct === "string" && direct.startsWith("http")) return direct;
    for (const v of Object.values(o)) {
      const hit = extractUrlFromUnknown(v);
      if (hit) return hit;
    }
  }
  return undefined;
}

function rssItemThumbnail(item: RssItem): string | undefined {
  const desc = item.description ?? "";
  const fromHtml = extractImgSrcFromHtml(desc);
  if (fromHtml) return fromHtml;
  const encUrl = item.enclosure?.["@_url"];
  if (typeof encUrl === "string" && encUrl.startsWith("http")) {
    const encType = item.enclosure?.["@_type"] ?? "";
    if (/image/i.test(encType) || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(encUrl)) {
      return encUrl;
    }
  }
  return (
    extractUrlFromUnknown(item["media:thumbnail"]) ?? extractUrlFromUnknown(item["media:content"])
  );
}

function normalizeTopic(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|and|for|with|from|into|over|after|amid|about|says|report|reports)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    headers: {
      "user-agent": "TimesOfSFBot/1.0 (+https://example.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed with ${response.status}`);
  }

  return response.text();
}

async function fetchFeedItems(url: string) {
  const xml = await fetchText(url);
  const parsed = parser.parse(xml);
  const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? [];
  return toArray<RssItem>(items);
}

function stripPublisherSuffix(title: string) {
  return title.replace(/\s+-\s+[^-]+$/, "").trim();
}

function normalizePublisher(raw: string) {
  return raw.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
}

function googleNewsPublisher(title: string) {
  const parts = title.split(/\s+-\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function isGoogleNewsPublisherMatch(title: string, sourceName: PreferredSourceName) {
  const publisher = normalizePublisher(googleNewsPublisher(title));
  if (!publisher) return false;
  return getSourceAliases(sourceName).some((alias) => normalizePublisher(alias) === publisher);
}

function significantTokens(text: string) {
  return normalizeTopic(text).split(" ").filter((w) => w.length > 3);
}

function countTokenMatches(tokens: string[], text: string) {
  const normalized = normalizeTopic(text);
  return tokens.filter((token) => normalized.includes(token)).length;
}

function deriveTopicFromHeadline(headline: string) {
  const withoutPublisher = stripPublisherSuffix(headline);
  const withoutPipeSite = withoutPublisher.replace(/\s*\|\s*[^|]{2,100}$/, "").trim();
  return normalizeTopic(withoutPipeSite);
}

/** Rich token bag for cross-outlet RSS matching (includes sample headlines, not just normalizedTopic). */
export function collectTopicMatchTokens(topic: TrendCandidate): string[] {
  const blob = [topic.topic, topic.normalizedTopic, ...(topic.sampleHeadlines ?? [])].filter(Boolean).join(" ");
  const tokens = significantTokens(blob);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 4) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 14) break;
  }
  return out;
}

function minDistinctMatches(tokenCount: number): number {
  if (tokenCount <= 0) return 99;
  if (tokenCount <= 2) return 1;
  return 2;
}

function pickBestFeedMatch(items: RssItem[], tokens: string[]): RssItem | null {
  const limit = Math.min(items.length, 45);
  const need = minDistinctMatches(tokens.length);
  let best: RssItem | null = null;
  let bestScore = 0;
  for (let i = 0; i < limit; i += 1) {
    const item = items[i];
    if (!item?.link || !item.title) continue;
    const searchable = `${stripPublisherSuffix(item.title)} ${item.description ?? ""}`;
    const score = countTokenMatches(tokens, searchable);
    if (score >= need && score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

export async function getTrendingTopics(): Promise<TrendCandidate[]> {
  const buckets: TrendCandidate[] = [];

  for (const feed of TREND_FEEDS) {
    try {
      const items = await fetchFeedItems(feed.url);
      for (const item of items.slice(0, 12)) {
        const title = item.title?.trim();
        if (!title) continue;
        const normalizedTopic = deriveTopicFromHeadline(title);
        if (!normalizedTopic || normalizedTopic.length < 8) continue;

        // Fuzzy match: check if this topic is similar to any existing bucket
        const currentTokens = normalizedTopic.split(" ").filter(t => t.length > 3);
        
        let existing = buckets.find(b => {
          const bTokens = b.normalizedTopic.split(" ").filter(t => t.length > 3);
          const overlap = currentTokens.filter(t => bTokens.includes(t));
          // Require multiple shared keywords so short headlines like "Robot wars" do not merge
          // unrelated stories just because one generic word overlaps.
          const overlapRatio = overlap.length / Math.min(currentTokens.length, bTokens.length);
          return overlap.length >= 2 && overlapRatio >= 0.5;
        });

        if (existing) {
          if (!existing.signalSources?.includes(feed.source.name)) {
            existing.signalCount += 1;
            existing.signalSources = [...(existing.signalSources ?? []), feed.source.name];
          }
          if (existing.sampleHeadlines.length < 4) {
            existing.sampleHeadlines.push(title);
          }
        } else {
          buckets.push({
            topic: title.replace(/\s*-\s*[^-]+$/, "").trim(),
            normalizedTopic,
            signalCount: 1,
            signalSources: [feed.source.name],
            sampleHeadlines: [title],
            primarySource: item.link ? withSourceMetadata({
              sourceName: feed.source.name,
              articleUrl: item.link,
              headline: title,
              publishedAt: item.pubDate,
              summary: item.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            }, feed.source) : undefined
          });
        }
      }
    } catch {
      continue;
    }
  }

  return buckets
    .sort((a, b) => b.signalCount - a.signalCount)
    .slice(0, config.trendLimit);
}

export async function findSourceArticle(topic: TrendCandidate, sourceName: PreferredSourceName): Promise<SourceSearchResult | null> {
  const feeds = SOURCE_FEEDS[sourceName];
  if (!feeds) return null;

  const topicTokens = collectTopicMatchTokens(topic);
  if (topicTokens.length === 0) return null;

  for (const feedUrl of feeds) {
    try {
      const items = await fetchFeedItems(feedUrl);
      const match = pickBestFeedMatch(items, topicTokens);

      if (match?.link && match?.title) {
        const thumb = rssItemThumbnail(match);
        return withSourceMetadata({
          sourceName,
          articleUrl: match.link,
          headline: match.title,
          publishedAt: match.pubDate,
          summary: match.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          imageUrl: thumb,
        });
      }
    } catch {
      continue;
    }
  }

  // Fallback: Google News RSS Search
  // If the direct feeds don't have it, we search Google News for the specific publication
  try {
    const sourceIdentifier = getSourceAliases(sourceName)[0].replace(/\s+/g, "");
    const qToks = topicTokens.slice(0, 6);
    const query = encodeURIComponent(`${qToks.join(" ")} source:${sourceIdentifier}`);
    const gnUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

    const items = await fetchFeedItems(gnUrl);

    const gnNeed = minDistinctMatches(topicTokens.length);
    let best: RssItem | null = null;
    let bestScore = 0;
    for (let i = 0; i < Math.min(items.length, 25); i += 1) {
      const item = items[i];
      if (!item?.link || !item.title) continue;
      if (!isGoogleNewsPublisherMatch(item.title, sourceName)) continue;
      const searchable = `${stripPublisherSuffix(item.title)} ${item.description ?? ""}`;
      const score = countTokenMatches(topicTokens, searchable);
      if (score >= gnNeed && score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    if (best?.link && best?.title) {
      const thumb = rssItemThumbnail(best);
      return withSourceMetadata({
        sourceName,
        articleUrl: best.link,
        headline: stripPublisherSuffix(best.title),
        publishedAt: best.pubDate,
        summary: best.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        imageUrl: thumb,
      });
    }
  } catch (error) {
    console.error(`Google News fallback failed for ${sourceName}:`, error);
  }

  return null;
}
