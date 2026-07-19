export type EvergreenGuide = {
  slug: string;
  title: string;
  description: string;
  /** ISO date for last editorial refresh */
  updatedAt: string;
  categoryHint?: string;
  sections: Array<{ heading: string; body: string }>;
};

/**
 * Stable, indexable SF explainers. Refresh copy weekly; keep slugs forever.
 */
export const EVERGREEN_GUIDES: EvergreenGuide[] = [
  {
    slug: "how-muni-works",
    title: "How Muni works in San Francisco",
    description:
      "A plain-language guide to Muni fares, Clipper, lines, delays, and how to follow official service changes in San Francisco.",
    updatedAt: "2026-07-01",
    categoryHint: "Transit",
    sections: [
      {
        heading: "What Muni is",
        body: "Muni is San Francisco’s primary surface transit system—buses, historic streetcars, cable cars, and the Metro light-rail lines operated by the SFMTA. It is the everyday backbone for neighborhoods that BART does not serve.",
      },
      {
        heading: "Fares and Clipper",
        body: "Most adult rides use Clipper (card or app) or MuniMobile. Fares and transfer rules change; always confirm the current adult, youth, senior, and low-income (Lifeline) rates on the SFMTA site before you rely on a number you saw last year.",
      },
      {
        heading: "When service changes",
        body: "Expect construction detours, special-event reroutes, and weekend Metro substitutions. Official alerts from SFMTA are the source of truth; Times of SF summarizes major civic impacts and links back to those notices.",
      },
      {
        heading: "Why it matters",
        body: "Transit reliability shapes jobs, school access, and neighborhood commerce. Following fare and service debates at the SFMTA Board is often as important as watching a single delayed N-Judah night.",
      },
    ],
  },
  {
    slug: "sf-neighborhoods-explained",
    title: "San Francisco neighborhoods, explained",
    description:
      "A practical overview of how San Francisco’s neighborhoods differ—housing, transit access, culture, and the civic issues that show up in local news.",
    updatedAt: "2026-07-01",
    categoryHint: "Civics",
    sections: [
      {
        heading: "One city, many microclimates",
        body: "Fog, hills, and zoning history mean the Mission, Sunset, Richmond, Tenderloin, and Bayview can feel like different cities on the same day. Local news often turns on which supervisors, merchants, and tenants are closest to a decision.",
      },
      {
        heading: "Housing and land use",
        body: "Density fights, shelter siting, and small-business displacement show up neighborhood by neighborhood. Citywide headlines usually hide a very local map of winners and losers.",
      },
      {
        heading: "How to read neighborhood news",
        body: "Ask: Who is the decision-maker? Which district supervisor? Is this a Planning, Police, or Public Works story? Times of SF links primary sources so you can check the block-level stakes yourself.",
      },
    ],
  },
  {
    slug: "weekend-in-sf",
    title: "What’s happening this weekend in San Francisco",
    description:
      "How to plan a San Francisco weekend: where we pull events, what to verify, and how to use Times of SF’s events calendar without missing last-minute changes.",
    updatedAt: "2026-07-01",
    categoryHint: "Events",
    sections: [
      {
        heading: "Start with the calendar",
        body: "Our /events page aggregates public listings with source links. Treat times and venues as leads—always open the organizer page before you commit travel time across the city.",
      },
      {
        heading: "Free and low-cost defaults",
        body: "Golden Gate Park, waterfront walks, neighborhood street fairs, and civic festivals fill most weekends. Paid shows sell out; free outdoor events move for weather and permits.",
      },
      {
        heading: "Transit tip",
        body: "Big festivals strain Muni and rideshares. Check SFMTA alerts the morning of, and give yourself a Clipper-ready backup route.",
      },
    ],
  },
  {
    slug: "sf-essentials",
    title: "San Francisco essentials for newcomers",
    description:
      "A practical SF starter kit: transit cards, fog, hills, civic basics, and how to stay informed without drowning in rumor.",
    updatedAt: "2026-07-01",
    categoryHint: "Culture",
    sections: [
      {
        heading: "Get around",
        body: "Clipper for Muni/BART/Caltrain, comfortable shoes for hills, and a light layer year-round. Car ownership is optional in many neighborhoods and expensive everywhere.",
      },
      {
        heading: "Stay informed",
        body: "Follow City Hall and SFMTA primary sources, then use Times of SF for synthesized context with citations. Avoid treating social rumor as confirmed until a named agency or reporter backs it.",
      },
      {
        heading: "Support local reporting",
        body: "Independent local media is thin. Subscribe to outlets you trust—and to our newsletter if you want topic-filtered SF briefings.",
      },
    ],
  },
];

export function getGuideBySlug(slug: string): EvergreenGuide | null {
  const key = slug.trim().toLowerCase();
  return EVERGREEN_GUIDES.find((g) => g.slug === key) ?? null;
}

export function allGuideSlugs(): string[] {
  return EVERGREEN_GUIDES.map((g) => g.slug);
}
