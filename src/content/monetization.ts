/**
 * Config-driven monetization slots.
 * Keep placeholders `active: false` until a real partner is live —
 * empty inventory must not appear on the homepage or elsewhere.
 */

export type SponsorSlot = {
  id: string;
  label: string;
  name: string;
  tagline: string;
  href: string;
  placement: "homepage" | "newsletter" | "category" | "events";
  active: boolean;
};

export type JobListing = {
  id: string;
  title: string;
  company: string;
  location: string;
  href: string;
  desks: Array<"Tech" | "Funding">;
  active: boolean;
};

export type AffiliateLink = {
  id: string;
  label: string;
  href: string;
  disclosure: string;
  guideSlugs: string[];
  active: boolean;
};

export type BoostedEvent = {
  id: string;
  title: string;
  venue: string;
  href: string;
  active: boolean;
};

/** Set VITE_ENABLE_ADS=true only after you have real traffic + AdSense approval. */
export function adsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_ADS === "true";
}

export const SPONSORS: SponsorSlot[] = [
  {
    id: "homepage-primary",
    label: "Presented by",
    name: "Your SF brand here",
    tagline: "Sponsor the hometown briefing — local reach, source-linked readers.",
    href: "mailto:hello@timesofsf.com?subject=Sponsorship",
    placement: "homepage",
    active: false,
  },
  {
    id: "category-primary",
    label: "Section sponsor",
    name: "Sponsor this desk",
    tagline: "Reach readers in a specific SF news section.",
    href: "mailto:hello@timesofsf.com?subject=Category%20sponsorship",
    placement: "category",
    active: false,
  },
  {
    id: "events-boost-slot",
    label: "Events partner",
    name: "Promote your SF event",
    tagline: "Paid boosts appear above the organic calendar.",
    href: "mailto:hello@timesofsf.com?subject=Event%20boost",
    placement: "events",
    active: false,
  },
];

export const JOBS: JobListing[] = [
  {
    id: "sample-eng",
    title: "Hiring in SF tech?",
    company: "List your role",
    location: "San Francisco / Hybrid",
    href: "mailto:hello@timesofsf.com?subject=SF%20Jobs%20listing",
    desks: ["Tech", "Funding"],
    active: false,
  },
];

export const AFFILIATES: AffiliateLink[] = [
  {
    id: "clipper",
    label: "Get a Clipper card (official)",
    href: "https://www.clippercard.com/",
    disclosure: "We may earn a commission from some links. We only recommend tools we would use.",
    guideSlugs: ["how-muni-works", "sf-essentials"],
    active: true,
  },
  {
    id: "sfmoma",
    label: "SFMOMA tickets",
    href: "https://www.sfmoma.org/",
    disclosure: "Museum links may be affiliate or partner relationships when available.",
    guideSlugs: ["weekend-in-sf", "sf-essentials"],
    active: true,
  },
];

export const BOOSTED_EVENTS: BoostedEvent[] = [
  {
    id: "boost-placeholder",
    title: "Feature your venue or festival",
    venue: "Paid placement",
    href: "mailto:hello@timesofsf.com?subject=Boosted%20event",
    active: false,
  },
];

export function sponsorsFor(placement: SponsorSlot["placement"]): SponsorSlot[] {
  return SPONSORS.filter((s) => s.active && s.placement === placement);
}

export function jobsForDesk(desk: string): JobListing[] {
  return JOBS.filter((j) => j.active && j.desks.includes(desk as "Tech" | "Funding"));
}

export function affiliatesForGuide(slug: string): AffiliateLink[] {
  return AFFILIATES.filter((a) => a.active && a.guideSlugs.includes(slug));
}
