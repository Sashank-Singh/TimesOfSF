export type PreferredSourceName =
  | "San Francisco Chronicle"
  | "TechCrunch"
  | "Bloomberg"
  | "Reuters"
  | "WSJ";

export interface TrendCandidate {
  topic: string;
  normalizedTopic: string;
  signalCount: number;
  sampleHeadlines: string[];
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
  bodyMarkdown: string;
  shortPost: string;
  topic: string;
  credits: Array<{
    sourceName: PreferredSourceName;
    articleUrl: string;
    factBullets: string[];
  }>;
}
