import { affiliatesForGuide } from "../content/monetization";
import type { EvergreenGuide } from "../content/evergreen";
import { categoryPath } from "../lib/routes";
import { NewsletterCta } from "./NewsletterCta";

type Props = {
  guide: EvergreenGuide;
  onNavigate: (path: string) => void;
};

export function GuidePage({ guide, onNavigate }: Props) {
  const affiliates = affiliatesForGuide(guide.slug);

  return (
    <article className="max-w-3xl mx-auto">
      <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-accent mb-4">SF Guide</p>
      <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">{guide.title}</h1>
      <p className="text-base md:text-lg text-ink/65 leading-relaxed mb-3">{guide.description}</p>
      <p className="text-[10px] font-mono uppercase tracking-widest text-ink/35 mb-10">
        Updated {guide.updatedAt}
        {guide.categoryHint && (
          <>
            {" "}
            ·{" "}
            <button
              type="button"
              className="hover:text-accent underline"
              onClick={() => onNavigate(categoryPath(guide.categoryHint!))}
            >
              {guide.categoryHint} news
            </button>
          </>
        )}
      </p>

      <div className="space-y-10">
        {guide.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-black mb-3">{section.heading}</h2>
            <p className="text-sm md:text-base text-ink/75 leading-relaxed">{section.body}</p>
          </section>
        ))}
      </div>

      {affiliates.length > 0 && (
        <aside className="mt-12 border border-ink/10 p-5 bg-ink/[0.02]">
          <p className="text-[10px] font-mono uppercase tracking-widest text-ink/40 mb-3">Useful links</p>
          <ul className="space-y-3">
            {affiliates.map((link) => (
              <li key={link.id}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="sponsored noopener noreferrer"
                  className="text-sm font-bold hover:text-accent"
                >
                  {link.label}
                </a>
                <p className="text-[11px] text-ink/45 mt-1">{link.disclosure}</p>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <NewsletterCta variant="compact" className="mt-12" />
    </article>
  );
}
