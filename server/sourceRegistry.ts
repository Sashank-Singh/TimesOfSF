import {
  AllowedSourceUse,
  PreferredSourceName,
  SourceReliabilityTier,
  SourceSearchResult,
  SourceType,
} from "./types";

export interface SourceRegistryEntry {
  id: string;
  name: PreferredSourceName;
  aliases?: string[];
  feeds: string[];
  type: SourceType;
  reliabilityTier: SourceReliabilityTier;
  allowedUse: AllowedSourceUse;
  trendEligible?: boolean;
}

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  {
    id: "techcrunch",
    name: "TechCrunch",
    aliases: ["TechCrunch"],
    feeds: [
      "https://techcrunch.com/category/startups/feed/",
      "https://techcrunch.com/funding/feed/",
      "https://techcrunch.com/category/artificial-intelligence/feed/",
    ],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "reuters",
    name: "Reuters",
    aliases: ["Reuters"],
    feeds: [
      "https://feeds.reuters.com/reuters/technologyNews",
      "https://feeds.reuters.com/reuters/businessNews",
      "https://feeds.reuters.com/Reuters/domesticNews",
      "https://feeds.reuters.com/Reuters/worldNews",
    ],
    type: "wire",
    reliabilityTier: "wire_service",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    aliases: ["Bloomberg"],
    feeds: ["https://feeds.bloomberg.com/technology/news.rss"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "ap",
    name: "AP News",
    aliases: ["AP", "AP News", "Associated Press"],
    feeds: ["https://apnews.com/hub/ap-top-news?output=rss"],
    type: "wire",
    reliabilityTier: "wire_service",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "fox-news",
    name: "Fox News",
    aliases: ["Fox News"],
    feeds: [
      "https://moxie.foxnews.com/google-publisher/tech.xml",
      "https://moxie.foxnews.com/google-publisher/politics.xml",
      "https://moxie.foxnews.com/google-publisher/us.xml",
    ],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "sf-chronicle",
    name: "San Francisco Chronicle",
    aliases: ["San Francisco Chronicle", "SF Chronicle"],
    feeds: ["https://www.sfchronicle.com/bayarea/feed/Bay-Area-News-106.php"],
    type: "local_news",
    reliabilityTier: "local_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "sf-standard",
    name: "The San Francisco Standard",
    aliases: ["The San Francisco Standard", "San Francisco Standard", "SF Standard"],
    feeds: ["https://sfstandard.com/feed/"],
    type: "local_news",
    reliabilityTier: "local_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "mission-local",
    name: "Mission Local",
    aliases: ["Mission Local"],
    feeds: ["https://missionlocal.org/feed/"],
    type: "local_news",
    reliabilityTier: "local_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "the-verge",
    name: "The Verge",
    aliases: ["The Verge"],
    feeds: ["https://www.theverge.com/rss/index.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "new-york-times",
    name: "New York Times",
    aliases: ["New York Times", "The New York Times", "NYTimes"],
    feeds: ["https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "bbc",
    name: "BBC",
    aliases: ["BBC", "BBC News"],
    feeds: ["https://feeds.bbci.co.uk/news/technology/rss.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "engadget",
    name: "Engadget",
    aliases: ["Engadget"],
    feeds: ["https://www.engadget.com/rss.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
    trendEligible: true,
  },
  {
    id: "wsj",
    name: "WSJ",
    aliases: ["WSJ", "Wall Street Journal", "The Wall Street Journal"],
    feeds: ["https://feeds.a.dj.com/rss/RSSWSJD.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
  },
  {
    id: "cnn",
    name: "CNN",
    aliases: ["CNN"],
    feeds: ["http://rss.cnn.com/rss/edition_technology.rss"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
  },
  {
    id: "npr",
    name: "NPR",
    aliases: ["NPR"],
    feeds: ["https://feeds.npr.org/1019/rss.xml"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
  },
  {
    id: "the-guardian",
    name: "The Guardian",
    aliases: ["The Guardian", "Guardian"],
    feeds: ["https://www.theguardian.com/technology/rss"],
    type: "reporting",
    reliabilityTier: "known_publisher",
    allowedUse: "headline_summary_link",
  },
];

export const TREND_FEEDS = SOURCE_REGISTRY.flatMap((source) =>
  source.trendEligible
    ? source.feeds.map((url) => ({
        url,
        source,
      }))
    : [],
);

export const SOURCE_FEEDS = SOURCE_REGISTRY.reduce(
  (acc, source) => {
    acc[source.name] = source.feeds;
    return acc;
  },
  {} as Record<PreferredSourceName, string[]>,
);

export function getSourceMetadata(sourceName: PreferredSourceName) {
  return SOURCE_REGISTRY.find((source) => source.name === sourceName);
}

export function getSourceAliases(sourceName: PreferredSourceName) {
  const source = getSourceMetadata(sourceName);
  return source?.aliases ?? [sourceName];
}

export function withSourceMetadata<T extends SourceSearchResult>(
  result: T,
  source = getSourceMetadata(result.sourceName),
): T {
  if (!source) return result;

  return {
    ...result,
    sourceId: source.id,
    sourceType: source.type,
    reliabilityTier: source.reliabilityTier,
    allowedUse: source.allowedUse,
  };
}
