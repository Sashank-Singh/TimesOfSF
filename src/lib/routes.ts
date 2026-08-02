import type { ArticleCategory } from "../types";

export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  "Civics",
  "Culture",
  "Tech",
  "Funding",
  "Transit",
  "Food",
  "Events",
];

const CATEGORY_BY_SLUG: Record<string, ArticleCategory> = {
  civics: "Civics",
  culture: "Culture",
  tech: "Tech",
  funding: "Funding",
  transit: "Transit",
  food: "Food",
  events: "Events",
};

export type AppRoute =
  | { kind: "home" }
  | { kind: "article"; slug: string }
  | { kind: "category"; category: ArticleCategory; slug: string }
  | { kind: "events" }
  | { kind: "digest" }
  | { kind: "guide"; slug: string }
  | { kind: "topic"; slug: string }
  | { kind: "bookmarks" }
  | { kind: "reset-password" }
  | { kind: "unknown"; path: string };

export function categoryToSlug(category: ArticleCategory | string): string {
  return category.trim().toLowerCase();
}

export function slugToCategory(slug: string): ArticleCategory | null {
  return CATEGORY_BY_SLUG[slug.trim().toLowerCase()] ?? null;
}

export function categoryPath(category: ArticleCategory | string): string {
  return `/category/${encodeURIComponent(categoryToSlug(category))}`;
}

export function eventsPath(): string {
  return "/events";
}

export function digestPath(): string {
  return "/digest";
}

export function guidePath(slug: string): string {
  return `/guides/${encodeURIComponent(slug)}`;
}

export function topicPath(slug: string): string {
  return `/topics/${encodeURIComponent(slug)}`;
}

export function articlePath(slug: string): string {
  return `/articles/${encodeURIComponent(slug)}`;
}

export function entityToTopicSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 80)
    // Trim separators last: slicing first can cut mid-separator and strand a trailing dash,
    // which would give the same entity two different topic URLs.
    .replace(/^-+|-+$/g, "");
}

export function parseAppPath(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/") return { kind: "home" };
  if (path === "/events") return { kind: "events" };
  if (path === "/digest") return { kind: "digest" };
  if (path === "/bookmarks" || path === "/reading-list") return { kind: "bookmarks" };
  if (path === "/reset-password") return { kind: "reset-password" };

  const articleMatch = path.match(/^\/articles\/([^/]+)$/);
  if (articleMatch) {
    try {
      return { kind: "article", slug: decodeURIComponent(articleMatch[1]).toLowerCase() };
    } catch {
      return { kind: "article", slug: articleMatch[1].toLowerCase() };
    }
  }

  const categoryMatch = path.match(/^\/category\/([^/]+)$/);
  if (categoryMatch) {
    let raw = categoryMatch[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
    const category = slugToCategory(raw);
    if (category) return { kind: "category", category, slug: categoryToSlug(category) };
  }

  const guideMatch = path.match(/^\/guides\/([^/]+)$/);
  if (guideMatch) {
    try {
      return { kind: "guide", slug: decodeURIComponent(guideMatch[1]).toLowerCase() };
    } catch {
      return { kind: "guide", slug: guideMatch[1].toLowerCase() };
    }
  }

  const topicMatch = path.match(/^\/topics\/([^/]+)$/);
  if (topicMatch) {
    try {
      return { kind: "topic", slug: decodeURIComponent(topicMatch[1]).toLowerCase() };
    } catch {
      return { kind: "topic", slug: topicMatch[1].toLowerCase() };
    }
  }

  return { kind: "unknown", path };
}

export function listPathFromRoute(route: AppRoute): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "category":
      return categoryPath(route.category);
    case "events":
      return eventsPath();
    case "digest":
      return digestPath();
    case "guide":
      return guidePath(route.slug);
    case "topic":
      return topicPath(route.slug);
    case "bookmarks":
      return "/bookmarks";
    case "reset-password":
      return "/reset-password";
    default:
      return "/";
  }
}

export const CATEGORY_SEO: Record<
  ArticleCategory,
  { title: string; description: string }
> = {
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
