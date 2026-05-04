import { XMLParser } from "fast-xml-parser";
import { config } from "./config";
import { PreferredSourceName, SourceSearchResult, TrendCandidate } from "./types";

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

const TREND_FEEDS = [
  "https://news.google.com/rss/search?q=technology+when:1d&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=startups+when:1d&hl=en-US&gl=US&ceid=US:en",
  "https://feeds.reuters.com/reuters/technologyNews",
  "https://techcrunch.com/feed/",
];

const SOURCE_QUERIES: Record<PreferredSourceName, string> = {
  "San Francisco Chronicle": "sfchronicle.com",
  "TechCrunch": "techcrunch.com",
  "Bloomberg": "bloomberg.com",
  "Reuters": "reuters.com",
  "WSJ": "wsj.com",
};

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
  const buckets = new Map<string, TrendCandidate>();

  for (const feed of TREND_FEEDS) {
    try {
      const items = await fetchFeedItems(feed);
      for (const item of items.slice(0, 12)) {
        const title = item.title?.trim();
        if (!title) continue;
        const normalizedTopic = deriveTopicFromHeadline(title);
        if (!normalizedTopic || normalizedTopic.length < 8) continue;

        const existing = buckets.get(normalizedTopic);
        if (existing) {
          existing.signalCount += 1;
          if (existing.sampleHeadlines.length < 4) {
            existing.sampleHeadlines.push(title);
          }
        } else {
          buckets.set(normalizedTopic, {
            topic: title.replace(/\s*-\s*[^-]+$/, "").trim(),
            normalizedTopic,
            signalCount: 1,
            sampleHeadlines: [title],
          });
        }
      }
    } catch {
      continue;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.signalCount - a.signalCount)
    .slice(0, config.trendLimit);
}

export async function findSourceArticle(topic: TrendCandidate, sourceName: PreferredSourceName): Promise<SourceSearchResult | null> {
  const siteQuery = SOURCE_QUERIES[sourceName];
  const query = encodeURIComponent(`"${topic.topic}" ${siteQuery} when:7d`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const items = await fetchFeedItems(url);
    const match = items.find((item) => item.link && item.title);
    if (!match || !match.link || !match.title) return null;

    return {
      sourceName,
      articleUrl: match.link,
      headline: match.title,
      publishedAt: match.pubDate,
      summary: match.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    };
  } catch {
    return null;
  }
}
