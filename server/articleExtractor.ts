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

function extractLeadImage(dom: JSDOM): string | undefined {
  const doc = dom.window.document;

  const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
  if (ogImage?.startsWith("http")) return ogImage;

  const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
  if (twitterImage?.startsWith("http")) return twitterImage;

  const imageSrc = doc.querySelector('link[rel="image_src"]')?.getAttribute("href");
  if (imageSrc?.startsWith("http")) return imageSrc;

  return undefined;
}

async function extractWithReadability(url: string): Promise<ReadabilityResult> {
  const html = await fetchHtml(url);
  const dom = new JSDOM(html, { url });
  const imageUrl = extractLeadImage(dom);
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    throw new Error("Readability returned null — could not extract article structure.");
  }

  const text = article.textContent?.trim() ?? "";
  if (text.length < 200) {
    throw new Error(`Readability extracted only ${text.length} chars — too thin to use.`);
  }

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
