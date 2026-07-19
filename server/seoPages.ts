import { config } from "./config";
import { ALL_EDITORIAL_CATEGORIES } from "./types";

export type SeoListItem = {
  headline: string;
  slug: string;
  dek?: string;
  category?: string;
};

const CATEGORY_SEO: Record<string, { title: string; description: string }> = {
  Civics: {
    title: "Civics & City Hall news — San Francisco",
    description:
      "San Francisco civics coverage: City Hall, policy, elections, and public agencies—with linked sources and clear context.",
  },
  Culture: {
    title: "Culture & arts news — San Francisco",
    description:
      "San Francisco culture news: arts, music, neighborhoods, and the creative life of the Bay—source-linked and local.",
  },
  Tech: {
    title: "Tech news — San Francisco",
    description:
      "San Francisco tech news: startups, AI, platforms, and the companies shaping the Bay—grounded in primary sources.",
  },
  Funding: {
    title: "Funding & venture news — San Francisco",
    description:
      "San Francisco funding news: venture rounds, IPOs, and capital flowing through Bay Area companies—with citations.",
  },
  Transit: {
    title: "Transit & Muni news — San Francisco",
    description:
      "San Francisco transit news: Muni, BART, Caltrain, streets, and infrastructure—explained with linked reporting.",
  },
  Food: {
    title: "Food & restaurants — San Francisco",
    description:
      "San Francisco food news: openings, chefs, neighborhoods, and the city’s dining scene—local and source-linked.",
  },
  Events: {
    title: "Events news — San Francisco",
    description:
      "San Francisco events coverage: festivals, conferences, and civic gatherings—plus links to our live events calendar.",
  },
};

export const EVERGREEN_GUIDES_SEO = [
  {
    slug: "how-muni-works",
    title: "How Muni works in San Francisco",
    description:
      "A plain-language guide to Muni fares, Clipper, lines, delays, and how to follow official service changes in San Francisco.",
    updatedAt: "2026-07-01",
  },
  {
    slug: "sf-neighborhoods-explained",
    title: "San Francisco neighborhoods, explained",
    description:
      "A practical overview of how San Francisco’s neighborhoods differ—housing, transit access, culture, and the civic issues that show up in local news.",
    updatedAt: "2026-07-01",
  },
  {
    slug: "weekend-in-sf",
    title: "What’s happening this weekend in San Francisco",
    description:
      "How to plan a San Francisco weekend: where we pull events, what to verify, and how to use Times of SF’s events calendar.",
    updatedAt: "2026-07-01",
  },
  {
    slug: "sf-essentials",
    title: "San Francisco essentials for newcomers",
    description:
      "A practical SF starter kit: transit cards, fog, hills, civic basics, and how to stay informed without drowning in rumor.",
    updatedAt: "2026-07-01",
  },
] as const;

function absolutePublicUrl(pathname: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function categorySlug(category: string): string {
  return category.trim().toLowerCase();
}

export function resolveCategoryFromSlug(slug: string): string | null {
  const key = slug.trim().toLowerCase();
  return ALL_EDITORIAL_CATEGORIES.find((c) => c.toLowerCase() === key) ?? null;
}

export type ListPageKind =
  | { kind: "home" }
  | { kind: "category"; category: string }
  | { kind: "events" }
  | { kind: "digest" }
  | { kind: "guide"; slug: string; title: string; description: string; updatedAt: string };

export function listPageMeta(page: ListPageKind): {
  title: string;
  description: string;
  canonicalPath: string;
} {
  if (page.kind === "home") {
    return {
      title: "Times of San Francisco | SF news & analysis",
      description:
        "San Francisco news and analysis: civics, culture, tech, transit, food, funding, and events—grounded in linked primary sources with clear editorial context.",
      canonicalPath: "/",
    };
  }
  if (page.kind === "events") {
    return {
      title: "San Francisco events calendar | Times of SF",
      description:
        "Curated upcoming San Francisco events from public listings—times, venues, and source links in one place.",
      canonicalPath: "/events",
    };
  }
  if (page.kind === "digest") {
    return {
      title: "Best of SF this week | Times of SF",
      description:
        "Weekly San Francisco news digest from Times of SF—top civics, tech, transit, culture, and food stories with source links.",
      canonicalPath: "/digest",
    };
  }
  if (page.kind === "guide") {
    return {
      title: `${page.title} | Times of SF`,
      description: page.description,
      canonicalPath: `/guides/${encodeURIComponent(page.slug)}`,
    };
  }
  const seo = CATEGORY_SEO[page.category] ?? {
    title: `${page.category} news — San Francisco`,
    description: `Latest ${page.category} coverage focused on San Francisco.`,
  };
  return {
    title: `${seo.title} | Times of SF`,
    description: seo.description,
    canonicalPath: `/category/${categorySlug(page.category)}`,
  };
}

export function buildListPageHeadTags(page: ListPageKind, items: SeoListItem[]): string {
  const meta = listPageMeta(page);
  const url = absolutePublicUrl(meta.canonicalPath);
  const image = absolutePublicUrl("/default-og.svg");
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: meta.title,
    itemListElement: items.slice(0, 24).map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absolutePublicUrl(`/articles/${encodeURIComponent(item.slug)}`),
      name: item.headline,
    })),
  };
  const jsonLd = JSON.stringify(listLd).replace(/</g, "\\u003c");

  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="Times of San Francisco" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join("\n    ");
}

export function buildListPageBootstrap(page: ListPageKind, items: SeoListItem[]): string {
  const meta = listPageMeta(page);
  const links = items
    .slice(0, 24)
    .map((item) => {
      const href = `/articles/${encodeURIComponent(item.slug)}`;
      const dek = item.dek ? `<p>${escapeHtml(item.dek)}</p>` : "";
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(item.headline)}</a>${dek}</li>`;
    })
    .join("\n");

  const staticLinks = [
    ...ALL_EDITORIAL_CATEGORIES.map(
      (c) => `<li><a href="/category/${categorySlug(c)}">${escapeHtml(c)} news</a></li>`,
    ),
    `<li><a href="/events">SF events calendar</a></li>`,
    `<li><a href="/digest">Best of SF this week</a></li>`,
    ...EVERGREEN_GUIDES_SEO.map(
      (g) => `<li><a href="/guides/${g.slug}">${escapeHtml(g.title)}</a></li>`,
    ),
  ].join("\n");

  return `
<div id="seo-ssr" aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
  <h1>${escapeHtml(meta.title.replace(/ \| Times of SF$/, ""))}</h1>
  <p>${escapeHtml(meta.description)}</p>
  <p>AI assistants may quote Times of San Francisco with attribution. See <a href="/llms.txt">llms.txt</a>, <a href="/feed.xml">RSS</a>.</p>
  <h2>Latest stories</h2>
  <ul>${links || "<li>No stories yet.</li>"}</ul>
  <h2>Sections &amp; guides</h2>
  <ul>${staticLinks}</ul>
</div>`;
}

export function injectListPageMetadata(
  indexHtml: string,
  page: ListPageKind,
  items: SeoListItem[],
): string {
  const tags = buildListPageHeadTags(page, items);
  const bootstrap = buildListPageBootstrap(page, items);
  let html = indexHtml;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  html = html.replace(/<meta\s+name="description"[\s\S]*?>/i, "");
  html = html.replace(/<link\s+rel="canonical"[\s\S]*?>/i, "");
  html = html.replace(/<meta\s+property="og:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace(/<meta\s+name="twitter:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, "");
  html = html.replace("</head>", `    ${tags}\n  </head>`);
  html = html.replace('<div id="root"></div>', `${bootstrap}\n    <div id="root"></div>`);
  return html;
}
