import type { Article } from "../types";
import { categoryPath, guidePath } from "../lib/routes";
import { EVERGREEN_GUIDES } from "../content/evergreen";
import { NewsletterCta } from "./NewsletterCta";

function startOfWeek(date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d;
}

export function buildWeeklyDigest(articles: Article[], now = new Date()): Article[] {
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const inWeek = articles.filter((a) => {
    const t = new Date(a.publishedAt).getTime();
    return t >= weekStart.getTime() && t < weekEnd.getTime();
  });

  if (inWeek.length >= 5) return inWeek.slice(0, 24);

  // Fallback: last 7 rolling days if calendar week is thin
  const rolling = new Date(now);
  rolling.setDate(rolling.getDate() - 7);
  return articles
    .filter((a) => new Date(a.publishedAt).getTime() >= rolling.getTime())
    .slice(0, 24);
}

type Props = {
  articles: Article[];
  onOpenArticle: (article: Article) => void;
  onNavigate: (path: string) => void;
};

export function DigestView({ articles, onOpenArticle, onNavigate }: Props) {
  const digest = buildWeeklyDigest(articles);
  const byCategory = new Map<string, Article[]>();
  for (const article of digest) {
    const list = byCategory.get(article.category) ?? [];
    list.push(article);
    byCategory.set(article.category, list);
  }

  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-accent mb-4">Weekly digest</p>
      <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">
        Best of SF this week
      </h1>
      <p className="text-base text-ink/65 leading-relaxed mb-10">
        A public, indexable roundup of Times of SF stories from the current week—grouped by desk, with
        deep links you can share.
      </p>

      {digest.length === 0 ? (
        <p className="text-lg italic font-serif text-ink/40 py-16">
          No stories in this week’s window yet. Check back after the pipeline publishes.
        </p>
      ) : (
        <div className="space-y-12">
          {[...byCategory.entries()].map(([category, items]) => (
            <section key={category}>
              <div className="flex items-baseline justify-between border-b border-ink/15 pb-2 mb-5">
                <h2 className="text-2xl font-black">{category}</h2>
                <button
                  type="button"
                  onClick={() => onNavigate(categoryPath(category))}
                  className="text-[10px] font-mono uppercase tracking-widest text-accent"
                >
                  All {category}
                </button>
              </div>
              <ul className="space-y-5">
                {items.map((article) => (
                  <li key={article.id}>
                    <button type="button" onClick={() => onOpenArticle(article)} className="text-left group">
                      <span className="block text-lg font-bold leading-snug group-hover:text-accent transition-colors">
                        {article.title}
                      </span>
                      {article.excerpt && (
                        <span className="block text-sm text-ink/55 mt-1 leading-relaxed">{article.excerpt}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <aside className="mt-16 border-t border-ink/10 pt-10">
        <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/40 mb-4">SF guides</h2>
        <ul className="space-y-3">
          {EVERGREEN_GUIDES.map((guide) => (
            <li key={guide.slug}>
              <button
                type="button"
                onClick={() => onNavigate(guidePath(guide.slug))}
                className="text-sm font-bold hover:text-accent"
              >
                {guide.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <NewsletterCta variant="compact" className="mt-12" />
    </div>
  );
}
