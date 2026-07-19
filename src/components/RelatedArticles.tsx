import type { Article } from "../types";
import { articlePath, categoryPath, entityToTopicSlug, topicPath } from "../lib/routes";

function scoreRelated(current: Article, candidate: Article): number {
  if (candidate.id === current.id) return -1;
  let score = 0;
  if (candidate.category === current.category) score += 3;
  const currentNames = new Set((current.entities ?? []).map((e) => e.name.toLowerCase()));
  for (const entity of candidate.entities ?? []) {
    if (currentNames.has(entity.name.toLowerCase())) score += 2;
  }
  return score;
}

export function pickRelatedArticles(current: Article, pool: Article[], limit = 3): Article[] {
  return [...pool]
    .map((article) => ({ article, score: scoreRelated(current, article) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || +new Date(b.article.publishedAt) - +new Date(a.article.publishedAt))
    .slice(0, limit)
    .map((row) => row.article);
}

type Props = {
  article: Article;
  related: Article[];
  onOpenArticle: (article: Article) => void;
  onNavigate: (path: string) => void;
};

export function RelatedArticles({ article, related, onOpenArticle, onNavigate }: Props) {
  const entityLinks = (article.entities ?? []).slice(0, 4);

  if (related.length === 0 && entityLinks.length === 0) return null;

  return (
    <section className="mt-16 border-t border-ink/10 pt-10" aria-labelledby="related-heading">
      <h2 id="related-heading" className="text-[10px] font-mono uppercase tracking-[0.25em] text-accent mb-6">
        Keep reading
      </h2>

      <p className="text-xs text-ink/50 mb-6">
        More in{" "}
        <button
          type="button"
          onClick={() => onNavigate(categoryPath(article.category))}
          className="underline decoration-accent/40 hover:text-accent"
        >
          {article.category}
        </button>
        {entityLinks.length > 0 && (
          <>
            {" "}
            · Topics:{" "}
            {entityLinks.map((entity, index) => (
              <span key={entity.name}>
                {index > 0 ? ", " : ""}
                <button
                  type="button"
                  onClick={() => onNavigate(topicPath(entityToTopicSlug(entity.name)))}
                  className="underline decoration-accent/40 hover:text-accent"
                >
                  {entity.name}
                </button>
              </span>
            ))}
          </>
        )}
      </p>

      {related.length > 0 && (
        <ul className="space-y-5">
          {related.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenArticle(item)}
                className="text-left group w-full"
              >
                <span className="text-[10px] font-mono uppercase tracking-widest text-ink/35">
                  {item.category}
                </span>
                <span className="block text-lg font-bold leading-snug group-hover:text-accent transition-colors">
                  {item.title}
                </span>
                <span className="sr-only">{articlePath(item.slug)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
