import type { Article } from "../types";
import { entityToTopicSlug } from "../lib/routes";
import { NewsletterCta } from "./NewsletterCta";

export function articlesForTopic(articles: Article[], topicSlug: string): {
  label: string;
  matches: Article[];
} {
  const slug = topicSlug.toLowerCase();
  let label = topicSlug.replace(/-/g, " ");
  const matches: Article[] = [];

  for (const article of articles) {
    for (const entity of article.entities ?? []) {
      if (entityToTopicSlug(entity.name) === slug) {
        label = entity.name;
        matches.push(article);
        break;
      }
    }
  }

  return { label, matches };
}

type Props = {
  topicSlug: string;
  articles: Article[];
  onOpenArticle: (article: Article) => void;
};

export function TopicHub({ topicSlug, articles, onOpenArticle }: Props) {
  const { label, matches } = articlesForTopic(articles, topicSlug);

  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-accent mb-4">Topic hub</p>
      <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">
        {label} — San Francisco coverage
      </h1>
      <p className="text-base text-ink/65 leading-relaxed mb-10">
        Stories that mention {label}, pulled from Times of SF reporting with linked sources. This hub stays at a
        stable URL so search and newsletters can keep pointing here.
      </p>

      {matches.length === 0 ? (
        <p className="text-lg italic font-serif text-ink/40 py-16">
          No published stories mention this topic yet.
        </p>
      ) : (
        <ul className="space-y-6">
          {matches.map((article) => (
            <li key={article.id} className="border-t border-ink/10 pt-5 first:border-t-0 first:pt-0">
              <button type="button" onClick={() => onOpenArticle(article)} className="text-left group">
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink/35">
                  {article.category}
                </span>
                <span className="block text-xl font-bold leading-snug group-hover:text-accent transition-colors">
                  {article.title}
                </span>
                {article.excerpt && (
                  <span className="block text-sm text-ink/55 mt-2 leading-relaxed">{article.excerpt}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <NewsletterCta variant="compact" className="mt-12" />
    </div>
  );
}
