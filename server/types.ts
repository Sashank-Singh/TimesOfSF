export type PreferredSourceName =
  | "San Francisco Chronicle"
  | "TechCrunch"
  | "Bloomberg"
  | "Reuters"
  | "WSJ"
  | "AP News"
  | "BBC"
  | "CNN"
  | "NPR"
  | "The Guardian"
  | "New York Times";

export interface TrendCandidate {
  topic: string;
  normalizedTopic: string;
  signalCount: number;
  sampleHeadlines: string[];
  primarySource?: SourceSearchResult;
}

export interface SourceSearchResult {
  sourceName: PreferredSourceName;
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
  }>;
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
