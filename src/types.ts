export interface ArticleEntity {
  name: string;
  definition: string;
}

export interface DataBlock {
  type: "chart";
  title: string;
  data: { label: string; value: number }[];
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
  date: string;
  category: "Civics" | "Culture" | "Tech" | "Transit" | "Food";
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
