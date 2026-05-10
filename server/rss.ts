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
  const clean = headline.replace(/[-|:].*$/, "").trim();
  return normalizeTopic(clean);
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

  const topicTokens = significantTokens(topic.normalizedTopic).slice(0, 5);

  for (const feedUrl of feeds) {
    try {
      const items = await fetchFeedItems(feedUrl);
      const match = items.find((item) => {
        if (!item.link || !item.title) return false;
        const searchable = `${stripPublisherSuffix(item.title)} ${item.description ?? ""}`;
        return countTokenMatches(topicTokens, searchable) >= Math.min(2, topicTokens.length);
      });

      if (match?.link && match?.title) {
        return withSourceMetadata({
          sourceName,
          articleUrl: match.link,
          headline: match.title,
          publishedAt: match.pubDate,
          summary: match.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
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
    // Google News supports boolean operators and source filters in its RSS search
    const query = encodeURIComponent(`"${topicTokens.join('" "')}" source:${sourceIdentifier}`);
    const gnUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    
    const items = await fetchFeedItems(gnUrl);
    
    // Google News appends " - Source Name" to titles.
    const match = items.find(item => {
        if (!item.link || !item.title) return false;
        if (!isGoogleNewsPublisherMatch(item.title, sourceName)) return false;
        const searchable = `${stripPublisherSuffix(item.title)} ${item.description ?? ""}`;
        return countTokenMatches(topicTokens, searchable) >= Math.min(2, topicTokens.length);
    });

    if (match?.link && match?.title) {
      return withSourceMetadata({
        sourceName,
        articleUrl: match.link,
        headline: stripPublisherSuffix(match.title),
        publishedAt: match.pubDate,
        summary: match.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      });
    }
  } catch (error) {
    console.error(`Google News fallback failed for ${sourceName}:`, error);
  }

  return null;
}
