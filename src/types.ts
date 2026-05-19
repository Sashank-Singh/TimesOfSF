export interface ArticleEntity {
  name: string;
  definition: string;
}

export interface DataBlock {
  type: "bar" | "histogram" | "scatter" | "line" | "chart";
  title: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  data: { label?: string; value?: number; x?: number; y?: number }[];
}

export interface ArticleCredit {
  sourceName: string;
  articleUrl: string;
  sourceType?: string;
  publishedAt?: string;
  confidence?: "high" | "medium" | "low";
  factBullets: string[];
}

export interface ArticleCitation {
  claim: string;
  sourceName: string;
  sourceUrl: string;
  quoteOrFact: string;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  author: string;
  /** ISO 8601 — same instant as `publishedAt`; kept for sorting / filters */
  date: string;
  /** ISO 8601 — when this article was published on Times of SF */
  publishedAt: string;
  category: "Civics" | "Culture" | "Tech" | "Funding" | "Transit" | "Food" | "Events";
  excerpt: string;
  content: string;
  imageUrl: string;
  imageCredit?: string;
  additionalImages?: {
    url: string;
    caption: string;
    credit: string;
  }[];
  readTime: string;
  tldr?: {
    whyItMatters: string;
    whoIsAffected: string;
    whatIsNext: string;
  };
  credits?: ArticleCredit[];
  citations?: ArticleCitation[];
  sourceUrls?: string[];
  entities?: ArticleEntity[];
  dataBlocks?: DataBlock[];
}

export type ArticleCategory = Article["category"];

export interface EventInfo {
  title: string;
  url: string;
  date: string;
  source: string;
}
