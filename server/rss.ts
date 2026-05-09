import { XMLParser } from "fast-xml-parser";
import { config } from "./config";
import { PreferredSourceName, SourceSearchResult, TrendCandidate } from "./types";
import { SOURCE_FEEDS, TREND_FEEDS, withSourceMetadata } from "./sourceRegistry";

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
          // If more than 50% overlap of significant keywords, they are the same story
          const overlapRatio = overlap.length / Math.min(currentTokens.length, bTokens.length);
          return overlapRatio >= 0.5;
        });

        if (existing) {
          existing.signalCount += 1;
          if (existing.sampleHeadlines.length < 4) {
            existing.sampleHeadlines.push(title);
          }
        } else {
          buckets.push({
            topic: title.replace(/\s*-\s*[^-]+$/, "").trim(),
            normalizedTopic,
            signalCount: 1,
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

  const topicTokens = topic.normalizedTopic
    .split(" ")
    .filter((w) => w.length > 3)
    .slice(0, 4);

  for (const feedUrl of feeds) {
    try {
      const items = await fetchFeedItems(feedUrl);
      const match = items.find((item) => {
        if (!item.link || !item.title) return false;
        const normalizedHeadline = item.title.toLowerCase();
        const matches = topicTokens.filter(t => normalizedHeadline.includes(t));
        return matches.length >= Math.min(2, topicTokens.length);
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
    const sourceIdentifier = sourceName.replace(/\s+/g, "");
    // Google News supports boolean operators and source filters in its RSS search
    const query = encodeURIComponent(`"${topicTokens.join('" "')}" source:${sourceIdentifier}`);
    const gnUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
    
    const items = await fetchFeedItems(gnUrl);
    
    // Google News appends " - Source Name" to titles.
    const match = items.find(item => {
        if (!item.link || !item.title) return false;
        return item.title.toLowerCase().includes(sourceName.toLowerCase());
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
  } catch (error) {
    console.error(`Google News fallback failed for ${sourceName}:`, error);
  }

  return null;
}
