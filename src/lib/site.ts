/** Public-facing publication name (matches index.html default title). */
export const SITE_NAME = "Times of San Francisco";
export const SITE_SHORT_NAME = "Times of SF";

/** Default meta description for home / discovery (answer-engine friendly lead). */
export const SITE_DEFAULT_DESCRIPTION =
  "San Francisco news and analysis: civics, culture, tech, transit, food, funding, and events—grounded in linked primary sources with clear editorial context.";

export function articlePath(slug: string): string {
  return `/articles/${encodeURIComponent(slug)}`;
}

export function getPublicOrigin(): string {
  if (typeof window === "undefined") return "";
  const env = import.meta.env.VITE_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  return window.location.origin;
}

/** Build an absolute URL for canonical / Open Graph (uses VITE_PUBLIC_SITE_URL when set). */
export function absoluteUrl(pathOrQuery: string): string {
  const base = getPublicOrigin();
  if (!base) return pathOrQuery;
  if (pathOrQuery.startsWith("http://") || pathOrQuery.startsWith("https://")) return pathOrQuery;
  if (pathOrQuery.startsWith("/")) return `${base}${pathOrQuery}`;
  return `${base}/${pathOrQuery}`;
}

export function truncateForMeta(text: string, max = 320): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}
