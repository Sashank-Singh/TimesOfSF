export interface Article {
  id: string;
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
}

export type ArticleCategory = Article["category"];
