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

function buildFallbackExtraction(searchResult: SourceSearchResult): SourceExtraction {
  const thumb =
    searchResult.imageUrl && searchResult.imageUrl.startsWith("http") ? searchResult.imageUrl : "";
  return {
    sourceName: searchResult.sourceName,
    sourceId: searchResult.sourceId,
    sourceType: searchResult.sourceType,
    reliabilityTier: searchResult.reliabilityTier,
    allowedUse: searchResult.allowedUse,
    articleUrl: searchResult.articleUrl,
    canonicalUrl: searchResult.articleUrl,
    headline: searchResult.headline,
    imageUrl: thumb,
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
