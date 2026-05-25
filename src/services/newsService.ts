import { Article, EventInfo } from "../types";

/** Vite build-time API origin (may be stale or same as the page). Resolved at fetch time via getApiBase(). */
const VITE_API_URL_RAW = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * Base URL for `/api/*` calls. Prefer same-origin relative URLs when the page and API share a host
 * (Coolify single service) so CORS and mis-set VITE_API_URL cannot break the site.
 */
export function getApiBase(): string {
  if (import.meta.env.DEV) {
    return VITE_API_URL_RAW || "http://localhost:8787";
  }
  const raw = VITE_API_URL_RAW;
  if (!raw) return "";
  if (/onrender\.com/i.test(raw)) return "";
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      if (new URL(raw).origin === window.location.origin) return "";
    } catch {
      return "";
    }
  }
  return raw;
}

function safeParseArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function normalizeCredits(post: any): Article["credits"] {
  const credits = safeParseArray(post.credits);
  if (credits.length === 0) return [];

  return credits
    .filter((credit: any) => credit?.sourceName && credit?.articleUrl)
    .map((credit: any) => ({
      sourceName: credit.sourceName,
      articleUrl: credit.articleUrl,
      sourceType: credit.sourceType || "reporting",
      publishedAt: credit.publishedAt,
      confidence: credit.confidence || "medium",
      factBullets: Array.isArray(credit.factBullets) ? credit.factBullets.slice(0, 5) : [],
    }));
}

function normalizeCitations(post: any): Article["citations"] {
  const citations = safeParseArray(post.citations);
  if (citations.length === 0) return [];

  const mapped = citations
    .filter((citation: any) => citation?.claim && citation?.sourceName && citation?.sourceUrl)
    .map((citation: any) => ({
      claim: citation.claim,
      sourceName: citation.sourceName,
      sourceUrl: citation.sourceUrl,
      quoteOrFact: citation.quoteOrFact || citation.claim,
    }));

  const seen = new Set<string>();
  const deduped = mapped.filter((c) => {
    const k = `${c.claim}|${c.sourceUrl}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return deduped.slice(0, 12);
}

function toIsoTimestamp(raw: unknown): string {
  if (raw == null) return new Date().toISOString();
  const d = typeof raw === "string" ? new Date(raw) : raw instanceof Date ? raw : new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function dbPostToArticle(post: any): Article {
  const desks: Article["category"][] = ["Tech", "Funding", "Civics", "Culture", "Transit", "Food", "Events"];
  const fromDb = typeof post.category === "string" && desks.includes(post.category as Article["category"])
    ? (post.category as Article["category"])
    : null;

  const categoryMap: Record<string, Article["category"]> = {
    tech: "Tech", technology: "Tech", ai: "Tech", software: "Tech", computing: "Tech",
    funding: "Funding", startup: "Funding", venture: "Funding", ipo: "Funding", raises: "Funding", capital: "Funding", round: "Funding", investment: "Funding",
    politics: "Civics", civics: "Civics", government: "Civics", policy: "Civics", mayor: "Civics", "city hall": "Civics", election: "Civics",
    culture: "Culture", arts: "Culture", entertainment: "Culture", music: "Culture", movie: "Culture", film: "Culture", festival: "Culture",
    transit: "Transit", transportation: "Transit", infrastructure: "Transit", muni: "Transit", bart: "Transit", train: "Transit", bus: "Transit", traffic: "Transit", caltrain: "Transit",
    food: "Food", restaurant: "Food", dining: "Food", chef: "Food", menu: "Food", opening: "Food", cafe: "Food", eat: "Food",
    events: "Events", meetup: "Events", summit: "Events", conference: "Events",
  };
  const topicLower = (post.topic || "").toLowerCase();
  const category =
    fromDb ?? Object.entries(categoryMap).find(([key]) => topicLower.includes(key))?.[1] ?? "Tech";

  const publishedAt = toIsoTimestamp(post.created_at ?? post.publishedAt);

  return {
    id: post.id.toString(),
    slug: post.slug,
    title: post.headline,
    author: "Times of SF Agent",
    date: publishedAt,
    publishedAt,
    category,
    excerpt: post.dek || post.short_post || "",
    content: post.body_markdown,
    imageUrl: post.imageUrl || undefined,
    imageCredit: post.imageCredit ?? undefined,
    readTime: `${Math.max(3, Math.ceil((post.body_markdown || "").split(" ").length / 200))} min`,
    tldr: post.tldr
      ? (typeof post.tldr === "string" ? (() => { try { return JSON.parse(post.tldr); } catch { return undefined; } })() : post.tldr)
      : undefined,
    credits: normalizeCredits(post),
    citations: normalizeCitations(post),
    sourceUrls: safeParseArray(post.sourceUrls),
    entities: safeParseArray(post.entities),
    dataBlocks: safeParseArray(post.dataBlocks),
  };
}

export async function fetchArticles(searchQuery?: string): Promise<Article[]> {
  const res = await fetch(`${getApiBase()}/api/posts`);
  if (!res.ok) {
    if (!import.meta.env.DEV && res.status === 404) {
      console.warn(
        "[Times of SF] GET /api/posts returned 404. This hostname is probably not your Coolify Node app (static host only). Point www DNS/proxy to the same service that runs Express, or set VITE_API_URL to your API origin and CORS_ALLOWED_ORIGINS on the API.",
      );
    }
    throw new Error(`API returned ${res.status} for /api/posts`);
  }
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];

  const articles = posts.map(dbPostToArticle);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    return articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.excerpt.toLowerCase().includes(q),
    );
  }

  return articles;
}

export async function fetchEvents(): Promise<EventInfo[]> {
  const res = await fetch(`${getApiBase()}/api/events`);
  if (!res.ok) {
    if (!import.meta.env.DEV && res.status === 404) {
      console.warn(
        "[Times of SF] GET /api/events returned 404 — same cause as /api/posts (see fetchArticles warning).",
      );
    }
    throw new Error(`API returned ${res.status} for /api/events`);
  }
  return await res.json();
}

export async function expandArticle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/posts/${id}/expand`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content;
  } catch (err) {
    console.error("expandArticle error:", err);
    return null;
  }
}
