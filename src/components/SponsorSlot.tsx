import { sponsorsFor, type SponsorSlot as Sponsor } from "../content/monetization";

type Props = {
  placement: Sponsor["placement"];
};

export function SponsorSlot({ placement }: Props) {
  const sponsors = sponsorsFor(placement);
  if (sponsors.length === 0) return null;

  return (
    <aside className="border border-ink/15 bg-ink/[0.02] px-4 py-3 mb-8" aria-label="Sponsorship">
      {sponsors.map((sponsor) => (
        <a
          key={sponsor.id}
          href={sponsor.href}
          className="block group"
          rel={sponsor.href.startsWith("http") ? "sponsored noopener noreferrer" : undefined}
          target={sponsor.href.startsWith("http") ? "_blank" : undefined}
        >
          <p className="text-[9px] font-mono uppercase tracking-[0.25em] text-ink/40 mb-1">
            {sponsor.label}
          </p>
          <p className="text-sm font-bold group-hover:text-accent transition-colors">{sponsor.name}</p>
          <p className="text-xs text-ink/55 mt-1 leading-relaxed">{sponsor.tagline}</p>
        </a>
      ))}
    </aside>
  );
}
