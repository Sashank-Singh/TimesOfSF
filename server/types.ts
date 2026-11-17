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
  | "VentureBeat"
  | "Wired"
  | "CNBC"
  | "Axios"
  | "GeekWire"
  | "Product Hunt"
  | "Hacker News"
  | "Y Combinator"
  | "Hugging Face"
  | "Crunchbase News"
  | "CB Insights"
  | "The Information"
  | "PitchBook News"
  | "Sifted"
  | "Fast Company"
  | "Business Insider"
  | "Official Document"
  | "Company Statement"
  | "Public Data"
  /** Owner-submitted article URL (not from RSS pipeline). */
  | "Submitted Link";

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

export type EditorialCategory =
  | "Tech"
  | "Funding"
  | "Civics"
  | "Culture"
  | "Transit"
  | "Food"
  | "Events";

export const ALL_EDITORIAL_CATEGORIES: EditorialCategory[] = [
  "Tech",
  "Funding",
  "Civics",
  "Culture",
  "Transit",
  "Food",
  "Events",
];

export interface TrendCandidate {
  topic: string;
  normalizedTopic: string;
  signalCount: number;
  signalSources?: PreferredSourceName[];
  sampleHeadlines: string[];
  primarySource?: SourceSearchResult;
  /** Desk routing for quotas and prompts */
  editorialCategory?: EditorialCategory;
  /** True when synthesized only to satisfy a quiet daily lane */
  quotaSeed?: boolean;
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
  /** RSS/media thumbnail when extraction has not run yet */
  imageUrl?: string;
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
  /** Final synthesized headline (for in-run dedupe snapshots). */
  publishedHeadline?: string;
  reason?: string;
  /** True when the article was assembled from source packets without full LLM synthesis (recovery path). */
  publishedViaFallback?: boolean;
}

export interface GeneratedPost {
  headline: string;
  slug: string;
  dek: string;
  imageUrl?: string;
  /** Hero line shown in UI (e.g. outlet attribution for preview images). */
  imageCredit?: string;
  bodyMarkdown: string;
  shortPost: string;
  topic: string;
  editorialCategory?: EditorialCategory;
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
    type: "bar" | "histogram" | "scatter" | "line";
    title: string;
    xAxisLabel: string;
    yAxisLabel: string;
    sourceName?: string;
    sourceUrl?: string;
    metric?: string;
    unit?: string;
    data: Array<{ label?: string; value?: number; x?: number; y?: number; sourceQuote?: string; unit?: string; metric?: string }>;
  }>;
}
