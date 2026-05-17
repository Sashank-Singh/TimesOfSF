import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { config } from "./config";
import type { SourceSearchResult, SourceExtraction } from "./types";

export type ReadabilityResult = {
  title: string;
  textContent: string;
  excerpt: string;
  byline?: string;
  siteName?: string;
  publishedTime?: string;
  content: string;
  imageUrl?: string;
};

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    headers: {
      "user-agent": "TimesOfSFBot/1.1 (+https://www.timesofsf.com)",
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Non-HTML content-type: ${contentType}`);
  }

  return response.text();
}

/** Aggressively find the best image from the page — meta tags, JSON-LD, article body. */
function extractLeadImage(dom: JSDOM, articleContent?: string): string | undefined {
  const doc = dom.window.document;
  const urls = new Set<string>();

  // 1. Open Graph secure & standard
  for (const sel of ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]']) {
    const url = doc.querySelector(sel)?.getAttribute("content");
    if (url?.startsWith("http")) urls.add(url);
  }

  // 2. Twitter / social image
  for (const sel of ['meta[name="twitter:image"]', 'meta[property="twitter:image"]']) {
    const url = doc.querySelector(sel)?.getAttribute("content");
    if (url?.startsWith("http")) urls.add(url);
  }

  // 3. Link rel
  const linkImage = doc.querySelector('link[rel="image_src"]')?.getAttribute("href");
  if (linkImage?.startsWith("http")) urls.add(linkImage);

  // 4. Schema.org JSON-LD
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || "");
      const walk = (obj: unknown): string | undefined => {
        if (!obj || typeof obj === "string") return undefined;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = walk(item);
            if (found) return found;
          }
          return undefined;
        }
        const o = obj as Record<string, unknown>;
        const img = o.image ?? o.thumbnailUrl ?? o.logo;
        if (typeof img === "string" && img.startsWith("http")) return img;
        if (typeof img === "object" && img) {
          const imgObj = img as Record<string, unknown>;
          if (typeof imgObj.url === "string" && imgObj.url.startsWith("http")) return imgObj.url;
          if (Array.isArray(img) && typeof img[0] === "string") return img[0];
        }
        for (const val of Object.values(o)) {
          const found = walk(val);
          if (found) return found;
        }
        return undefined;
      };
      const found = walk(parsed);
      if (found) urls.add(found);
    } catch {
      // invalid JSON — skip
    }
  }

  // 5. First <img> in Readability's parsed article content (the real article body)
  if (articleContent) {
    const imgMatch = articleContent.match(/<img[^>]+src=["']([^"']+)["']/i);
    const fromArticle = imgMatch?.[1]?.trim();
    if (fromArticle?.startsWith("http") && !fromArticle.includes("1x1") && !fromArticle.includes("pixel")) {
      urls.add(fromArticle);
    }
  }

  // 6. First meaningful <img> from the raw page (skip icons, trackers, tiny images)
  const imgs = doc.querySelectorAll("img[src]");
  for (const img of imgs) {
    const src = img.getAttribute("src") || "";
    if (!src.startsWith("http") && !src.startsWith("//")) continue;
    const fullSrc = src.startsWith("//") ? `https:${src}` : src;
    const w = img.getAttribute("width");
    const h = img.getAttribute("height");
    // Skip tiny images (icons, trackers)
    if (w && parseInt(w) < 200 && h && parseInt(h) < 200) continue;
    // Skip obvious junk
    if (/pixel|tracker|icon|spacer|blank|1x1|beacon|analytics|transparent/i.test(fullSrc)) continue;
    const lowerSrc = fullSrc.toLowerCase();
    if (/\.(jpg|jpeg|png|webp)(\?|$)/.test(lowerSrc)) {
      urls.add(fullSrc);
    }
  }

  // 7. Prefer larger / more canonical URL patterns (hero, featured, main, lead)
  const candidates = [...urls];
  const heroPattern = /hero|featured|main|lead|top|primary|cover|header/i;
  const heroMatch = candidates.find((c) => heroPattern.test(c));
  if (heroMatch) return heroMatch;
  // Prefer secure URLs
  const https = candidates.find((c) => c.startsWith("https://"));
  if (https) return https;
  return candidates[0];
}

async function extractWithReadability(url: string): Promise<ReadabilityResult> {
  const html = await fetchHtml(url);
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Readability returned null — could not extract article structure.");
  }

  const text = article.textContent?.trim() ?? "";
  if (text.length < 200) {
    throw new Error(`Readability extracted only ${text.length} chars — too thin to use.`);
  }

  const imageUrl = extractLeadImage(dom, article.content);

  return {
    title: article.title ?? "",
    textContent: text,
    excerpt: article.excerpt ?? "",
    byline: article.byline,
    siteName: article.siteName,
    publishedTime: article.publishedTime,
    content: article.content ?? "",
    imageUrl,
  };
}

function extractParagraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 80)
    .slice(0, 8);
}

function buildFacts(summary: string, paragraphs: string[]) {
  const sentences = [summary, ...paragraphs]
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
    .slice(0, 6);

  return [...new Set(sentences)].slice(0, 5);
}

/** Extract numeric claims from text for chart/data-block enrichment. */
export function extractNumericFacts(text: string): string[] {
  const patterns = [
    /\$\s*[\d,.]+(?:\s*(?:million|billion|trillion|thousand|M|B|K|mn|bn))?(?:\s*(?:in|from|to|up|down|of)\s+[\d,.%]+)?/gi,
    /[\d,.]+%\s*(?:of|from|to|up|down|year-over-year|yoy|growth|decline)?/gi,
    /(?:raised|valued at|valuation|revenue|funding|series\s+[a-z]|acquired|deal|investment)\s+(?:of\s+)?[\w\d,.$%]+/gi,
    /(?:worth|estimated|projected|targeted|expected)\s+(?:at\s+)?[\w\d,.$%]+\s*(?:million|billion|trillion)?/gi,
    /(?:users|customers|employees|subscribers|members)\s+(?:of\s+)?[\d,.]+(?:\s*\+|\s*million|\s*billion)?/gi,
    /\b[\d,.]+(?:\s*[-–])?\s*(?:year|month|quarter|day|week|hour)(?:\s*[-–]\s*[\d,.]+)?(?:\s*year-over-year)?(?:\s+growth|\s+decline|\s+increase|\s+decrease)?/gi,
  ];

  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const trimmed = match[0].trim();
      if (trimmed.length > 3) found.add(trimmed);
    }
  }

  return [...found].slice(0, 12);
}

export async function extractWithReadabilityFallback(
  searchResult: SourceSearchResult,
): Promise<SourceExtraction> {
  try {
    const article = await extractWithReadability(searchResult.articleUrl);
    const paragraphs = extractParagraphs(article.textContent);
    const facts = buildFacts(article.title || searchResult.headline, paragraphs);
    const numericFacts = extractNumericFacts(article.textContent);

    return {
      sourceName: searchResult.sourceName,
      sourceId: searchResult.sourceId,
      sourceType: searchResult.sourceType,
      reliabilityTier: searchResult.reliabilityTier,
      allowedUse: searchResult.allowedUse,
      articleUrl: searchResult.articleUrl,
      canonicalUrl: searchResult.articleUrl,
      headline: article.title || searchResult.headline,
      publishedAt: article.publishedTime || searchResult.publishedAt,
      summary: article.excerpt || article.title || searchResult.headline,
      textExcerpt: article.textContent.slice(0, 4000),
      facts: [...facts, ...numericFacts],
      imageUrl: searchResult.imageUrl || article.imageUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Readability extraction failed for ${searchResult.articleUrl}: ${msg}`);
    throw err;
  }
}
