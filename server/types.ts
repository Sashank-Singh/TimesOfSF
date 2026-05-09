export type PreferredSourceName =
  | "San Francisco Chronicle"
  | "The San Francisco Standard"
  | "Mission Local"
  | "TechCrunch"
  | "Bloomberg"
  | "Reuters"
  | "WSJ"
  | "AP News"
  | "Fox News"
  | "BBC"
  | "CNN"
  | "NPR"
  | "The Guardian"
  | "New York Times"
  | "The Verge"
  | "Engadget"
  | "Official Document"
  | "Company Statement"
  | "Public Data";

export type SourceType =
  | "reporting"
  | "official_document"
  | "company_statement"
  | "court_filing"
  | "data_source"
  | "social_post"
  | "local_news"
  | "wire"
  | "analysis";

export type SourceReliabilityTier =
  | "primary"
  | "known_publisher"
  | "wire_service"
  | "local_publisher"
  | "unverified";

export type AllowedSourceUse =
  | "headline_summary_link"
  | "facts_with_attribution"
  | "licensed"
  | "public_domain";

export interface TrendCandidate {
  topic: string;
  normalizedTopic: string;
  signalCount: number;
  sampleHeadlines: string[];
  primarySource?: SourceSearchResult;
}

export interface SourceSearchResult {
  sourceName: PreferredSourceName;
  sourceId?: string;
  sourceType?: SourceType;
  reliabilityTier?: SourceReliabilityTier;
  allowedUse?: AllowedSourceUse;
  articleUrl: string;
  headline: string;
  publishedAt?: string;
  summary?: string;
}

export interface SourceAttempt {
  sourceName: PreferredSourceName;
  status: "success" | "failed";
  reason?: string;
  result?: SourceExtraction;
}

export interface SourceExtraction {
  sourceName: PreferredSourceName;
  sourceId?: string;
  sourceType?: SourceType;
  reliabilityTier?: SourceReliabilityTier;
  allowedUse?: AllowedSourceUse;
  articleUrl: string;
  canonicalUrl: string;
  headline: string;
  publishedAt?: string;
  summary: string;
  textExcerpt: string;
  facts: string[];
  imageUrl?: string;
}

export interface PipelineRunResult {
  runId: string;
  topic: TrendCandidate | null;
  successfulSources: SourceExtraction[];
  failedSources: SourceAttempt[];
  published: boolean;
  postId?: string;
  reason?: string;
}

export interface GeneratedPost {
  headline: string;
  slug: string;
  dek: string;
  imageUrl?: string;
  bodyMarkdown: string;
  shortPost: string;
  topic: string;
  credits: Array<{
    sourceName: PreferredSourceName;
    articleUrl: string;
    factBullets: string[];
    sourceType?: SourceType;
    publishedAt?: string;
    confidence?: "high" | "medium" | "low";
  }>;
  citations?: Array<{
    claim: string;
    sourceName: PreferredSourceName;
    sourceUrl: string;
    quoteOrFact: string;
  }>;
  sourceUrls?: string[];
  headlineHash?: string;
  canonicalKey?: string;
  storyFingerprint?: {
    normalizedTitle: string;
    sourceUrls: string[];
    sourceNames: PreferredSourceName[];
    keyEntities: string[];
    simhash: string;
  };
  tldr?: {
    whyItMatters: string;
    whoIsAffected: string;
    whatIsNext: string;
  };
  entities?: Array<{
    name: string;
    definition: string;
  }>;
  dataBlocks?: Array<{
    type: "chart";
    title: string;
    data: Array<{ label: string; value: number }>;
  }>;
}
