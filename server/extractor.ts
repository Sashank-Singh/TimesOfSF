import { config } from "./config";
import { SourceExtraction, SourceSearchResult } from "./types";

function decodeEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

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

function pickMeta(html: string, key: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return "";
}

function extractParagraphs(html: string) {
  const matches = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((match) => stripTags(match[1]))
    .filter((text) => text.length > 80)
    .slice(0, 8);
}

function buildFacts(summary: string, paragraphs: string[]) {
  const sentences = [summary, ...paragraphs]
    .join(" ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 40)
    .slice(0, 4);

  return [...new Set(sentences)].slice(0, 3);
}

export async function extractSource(searchResult: SourceSearchResult): Promise<SourceExtraction> {
  const response = await fetch(searchResult.articleUrl, {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    redirect: "follow",
    headers: {
      "user-agent": "TimesOfSFBot/1.0 (+https://example.com)",
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Article fetch failed with ${response.status}`);
  }

  const html = await response.text();
  const canonicalUrl = pickMeta(html, "og:url") || response.url || searchResult.articleUrl;
  const metaTitle = pickMeta(html, "og:title") || pickMeta(html, "twitter:title");
  const metaDescription =
    pickMeta(html, "description") ||
    pickMeta(html, "og:description") ||
    pickMeta(html, "twitter:description") ||
    searchResult.summary ||
    "";
  const paragraphs = extractParagraphs(html);
  const textExcerpt = paragraphs.join(" ").slice(0, 2400);
  const facts = buildFacts(metaDescription, paragraphs);

  if (!metaDescription && textExcerpt.length < 200) {
    throw new Error("Insufficient accessible article text");
  }

  return {
    sourceName: searchResult.sourceName,
    articleUrl: searchResult.articleUrl,
    canonicalUrl,
    headline: metaTitle || searchResult.headline,
    publishedAt: searchResult.publishedAt,
    summary: metaDescription || searchResult.headline,
    textExcerpt,
    facts,
  };
}
