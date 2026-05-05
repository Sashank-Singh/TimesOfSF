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

const TREND_FEEDS: { url: string; sourceName: PreferredSourceName }[] = [
  { url: "https://techcrunch.com/category/startups/feed/", sourceName: "TechCrunch" },
  { url: "https://techcrunch.com/funding/feed/", sourceName: "TechCrunch" },
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", sourceName: "TechCrunch" },
  { url: "https://feeds.reuters.com/reuters/technologyNews", sourceName: "Reuters" },
  { url: "https://feeds.bloomberg.com/technology/news.rss", sourceName: "Bloomberg" },
  { url: "https://moxie.foxnews.com/google-publisher/politics.xml", sourceName: "AP News" },
  { url: "https://moxie.foxnews.com/google-publisher/us.xml", sourceName: "AP News" },
  { url: "https://www.sfchronicle.com/bayarea/feed/Bay-Area-News-106.php", sourceName: "San Francisco Chronicle" },
  { url: "https://sfstandard.com/feed/", sourceName: "AP News" }, // Mapping to AP News as a fallback source type
  { url: "https://missionlocal.org/feed/", sourceName: "AP News" },
  { url: "https://www.theverge.com/rss/index.xml", sourceName: "TechCrunch" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", sourceName: "New York Times" as any },
  { url: "https://feeds.bbci.co.uk/news/technology/rss.xml", sourceName: "BBC" },
  { url: "https://www.engadget.com/rss.xml", sourceName: "TechCrunch" }
];

const SOURCE_FEEDS: Record<PreferredSourceName, string[]> = {
  "San Francisco Chronicle": ["https://www.sfchronicle.com/bayarea/feed/Bay-Area-News-106.php"],
  "TechCrunch": ["https://techcrunch.com/category/startups/feed/", "https://techcrunch.com/funding/feed/", "https://techcrunch.com/category/artificial-intelligence/feed/"],
  "Bloomberg": ["https://feeds.bloomberg.com/technology/news.rss"],
  "Reuters": ["https://feeds.reuters.com/reuters/technologyNews", "https://feeds.reuters.com/reuters/businessNews", "https://feeds.reuters.com/Reuters/domesticNews", "https://feeds.reuters.com/Reuters/worldNews"],
  "WSJ": ["https://feeds.a.dj.com/rss/RSSWSJD.xml"],
  "AP News": ["https://moxie.foxnews.com/google-publisher/tech.xml", "https://moxie.foxnews.com/google-publisher/politics.xml", "https://moxie.foxnews.com/google-publisher/us.xml"],
  "BBC": ["https://feeds.bbci.co.uk/news/technology/rss.xml"],
  "CNN": ["http://rss.cnn.com/rss/edition_technology.rss"],
  "NPR": ["https://feeds.npr.org/1019/rss.xml"],
  "The Guardian": ["https://www.theguardian.com/technology/rss"],
  "New York Times": ["https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"]
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
      const items = await fetchFeedItems(feed.url);
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
            primarySource: item.link ? {
              sourceName: feed.sourceName,
              articleUrl: item.link,
              headline: title,
              publishedAt: item.pubDate,
              summary: item.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            } : undefined
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
        return {
          sourceName,
          articleUrl: match.link,
          headline: match.title,
          publishedAt: match.pubDate,
          summary: match.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}
