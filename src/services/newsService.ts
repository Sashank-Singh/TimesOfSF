import { Article, EventInfo } from "../types";

export const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?q=80&w=2070&auto=format&fit=crop";

/** Same-origin in production when unset (Coolify: one container serves `/` + `/api`). */
const API_BASE = (() => {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return import.meta.env.DEV ? "http://localhost:8787" : "";
})();

function normalizeCredits(post: any): Article["credits"] {
  if (!Array.isArray(post.credits)) return [];

  return post.credits
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
  if (!Array.isArray(post.citations)) return [];

  const mapped = post.citations
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

function getCategoryImage(category: string, id: number): string {
  const images: Record<string, string[]> = {
    Tech: [
      "photo-1518770660439-4636190af475", // Circuit
      "photo-1485827404703-89b55fcc595e", // AI
      "photo-1550751827-4bd374c3f58b", // Cyber
      "photo-1526374965328-7f61d4dc18c5"  // Data
    ],
    Funding: [
      "photo-1553729459-efe14ef6055d", // Success
      "photo-1559526324-4b87b5e36e44", // Business
      "photo-1454165833221-d7d138652371", // Growth
      "photo-1526304640581-d334cdbbf45e"  // Currency
    ],
    Civics: [
      "photo-1529107386315-e1a2ed48a620", // City Hall
      "photo-1449034446853-66c86144b0ad", // SF
      "photo-1521737604893-d14cc237f11d", // Meeting
      "photo-1517048676732-d65bc937f952"  // Workshop
    ],
    Culture: [
      "photo-1492684223066-81342ee5ff30", // Event
      "photo-1501281668745-f7f57925c3b4", // Festival
      "photo-1460661419201-fd4cecdf8a8b", // Arts
      "photo-1514525253344-99a429932402"  // Music
    ],
    Transit: [
      "photo-1544620347-c4fd4a3d5957", // Bus
      "photo-1474487059400-f19706634790", // Train
      "photo-1519011985187-444d62641929", // Station
      "photo-1556011504-0370498e8749"  // Bridge
    ],
    Food: [
      "photo-1504674900247-0877df9cc836", // Platter
      "photo-1517248135467-4c7edcad34c4", // Restaurant
      "photo-1414235077428-338989a2e8c0", // Fine dining
      "photo-1559339352-11d035aa65de"  // Cafe
    ],
    Events: [
      "photo-1492684223066-81342ee5ff30",
      "photo-1511578314322-379afb476865",
      "photo-1540575467063-030a4c18b661",
      "photo-1505373877841-8d25f7d46678",
    ],
  };

  const pool = images[category] || images["Tech"];
  const photoId = pool[id % pool.length];
  return `https://images.unsplash.com/${photoId}?auto=format&fit=crop&q=80&w=1200`;
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
    imageUrl: post.imageUrl || getCategoryImage(category, post.id),
    imageCredit: post.imageCredit ?? (post.imageUrl ? "Source preview" : "Unsplash"),
    readTime: `${Math.max(3, Math.ceil((post.body_markdown || "").split(" ").length / 200))} min`,
    tldr: post.tldr || undefined,
    credits: normalizeCredits(post),
    citations: normalizeCitations(post),
    sourceUrls: Array.isArray(post.sourceUrls) ? post.sourceUrls : [],
    entities: Array.isArray(post.entities) ? post.entities : [],
    dataBlocks: Array.isArray(post.dataBlocks) ? post.dataBlocks : [],
  };
}

export async function fetchArticles(searchQuery?: string): Promise<Article[]> {
  try {
    const res = await fetch(`${API_BASE}/api/posts`);
    if (!res.ok) return [];
    const posts = await res.json();
    if (!Array.isArray(posts) || posts.length === 0) return [];
    
    const articles = posts.map(dbPostToArticle);
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return articles.filter(a => 
        a.title.toLowerCase().includes(q) || 
        a.content.toLowerCase().includes(q) || 
        a.excerpt.toLowerCase().includes(q)
      );
    }
    
    return articles;
  } catch {
    return [];
  }
}

export async function fetchEvents(): Promise<EventInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/api/events`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function expandArticle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/posts/${id}/expand`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content;
  } catch (err) {
    console.error("expandArticle error:", err);
    return null;
  }
}
