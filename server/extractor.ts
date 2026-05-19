import { JSDOM } from "jsdom";
import { SourceExtraction, SourceSearchResult } from "./types";
import { config } from "./config";
import { extractWithReadabilityFallback } from "./articleExtractor";

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Minimal HTML-to-text stripping for RSS descriptions only */
function stripTags(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function tryFetchImageFromPage(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(config.sourceTimeoutMs),
      headers: {
        "user-agent": "TimesOfSFBot/1.1 (+https://www.timesofsf.com)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) return undefined;
    const html = await response.text();
    const dom = new JSDOM(html, { url });

    // Check meta tags
    for (const sel of ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]']) {
      const val = dom.window.document.querySelector(sel)?.getAttribute("content") || dom.window.document.querySelector(sel)?.getAttribute("href");
      if (val?.startsWith("http")) return val;
    }

    // First large <img> in the page
    const imgs = dom.window.document.querySelectorAll("img[src]");
    for (const img of imgs) {
      const src = (img.getAttribute("src") || "").trim();
      if (!src) continue;
      const fullSrc = src.startsWith("//") ? `https:${src}` : src;
      if (!fullSrc.startsWith("http")) continue;
      if (/pixel|tracker|icon|spacer|blank|1x1|beacon|analytics|transparent/i.test(fullSrc)) continue;
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(fullSrc)) return fullSrc;
      if (/\.(gif)(\?|$)/i.test(fullSrc) && !/spinner|loading/i.test(fullSrc)) return fullSrc;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function buildFallbackExtraction(searchResult: SourceSearchResult): Promise<SourceExtraction> {
  let imageUrl = searchResult.imageUrl?.startsWith("http") ? searchResult.imageUrl : undefined;
  if (!imageUrl) {
    imageUrl = await tryFetchImageFromPage(searchResult.articleUrl);
  }
  return {
    sourceName: searchResult.sourceName,
    sourceId: searchResult.sourceId,
    sourceType: searchResult.sourceType,
    reliabilityTier: searchResult.reliabilityTier,
    allowedUse: searchResult.allowedUse,
    articleUrl: searchResult.articleUrl,
    canonicalUrl: searchResult.articleUrl,
    headline: searchResult.headline,
    imageUrl: imageUrl || "",
    publishedAt: searchResult.publishedAt,
    summary: searchResult.headline,
    textExcerpt: searchResult.summary || "",
    facts: [searchResult.summary, searchResult.headline].filter(Boolean) as string[],
  };
}

export async function extractSource(searchResult: SourceSearchResult): Promise<SourceExtraction> {
  // Primary: full-article extraction via Mozilla Readability
  // Gives us the real article text, headings, excerpts — far better than RSS snippets.
  if (!config.disableNewsPlease) {
    try {
      return await extractWithReadabilityFallback(searchResult);
    } catch {
      // Fall through to RSS metadata fallback
    }
  }

  // Fallback: RSS metadata only (headline + description)
  return buildFallbackExtraction(searchResult);
}

export async function searchGoogleImage(query: string): Promise<string | undefined> {
  if (!config.serperApiKey) {
    console.warn("SERPER_API_KEY not set. Skipping Google Image search.");
    return undefined;
  }

  try {
    const response = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": config.serperApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 1 }),
    });

    if (!response.ok) return undefined;
    const data = await response.json();
    return data.images?.[0]?.imageUrl;
  } catch (error) {
    console.error("Google Image search failed:", error);
    return undefined;
  }
}
