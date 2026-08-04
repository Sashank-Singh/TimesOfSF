/**
 * Build a high-precision search query for finding a topical image.
 * Combines the synthesized headline (what the article is actually about),
 * the category (for topical / aesthetic anchoring), and a San Francisco locale hint
 * so results bias toward local / news imagery. Quoted phrases improve accuracy.
 */
export function buildImageSearchQuery(input: {
  headline?: string;
  category?: string;
  topic?: string;
  excerpt?: string;
}): string {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "as", "is", "are", "was", "were",
    "be", "by", "at", "from", "this", "that", "it", "its", "over", "amid", "after", "before", "but",
  ]);

  const pickKeyPhrases = (text: string, max = 6): string[] => {
    if (!text) return [];
    const cleaned = text
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()));
    return cleaned.slice(0, max);
  };

  const phrase = (input.headline || input.topic || "").trim().replace(/\s+/g, " ");
  const phrases: string[] = [];
  if (phrase && phrase.length >= 6) phrases.push(`"${phrase.slice(0, 80)}"`);

  const filler = pickKeyPhrases(input.excerpt || input.topic || "", 4);
  if (filler.length) phrases.push(filler.join(" "));

  const category = (input.category || "").trim();
  const categoryTerm = category && category.toLowerCase() !== "tech" ? category.toLowerCase() : "";

  const parts = [...phrases];
  if (categoryTerm) parts.push(categoryTerm);
  parts.push("San Francisco news photo");

  return parts.filter(Boolean).join(" ");
}

const SKIP_DOMAIN_PATTERNS = [
  /pinterest\./i,
  /shutterstock\.com/i,
  /istockphoto\.com/i,
  /gettyimages\.com/i,
  /stock\.adobe\.com/i,
  /depositphotos\.com/i,
  /123rf\.com/i,
  /alamy\.com/i,
  /dreamstime\.com/i,
  /vectorstock/i,
  /vecteezy/i,
  /fineartamerica/i,
  /redbubble/i,
  /zazzle/i,
  /teepublic/i,
];

const SKIP_TITLE_PATTERNS = [
  /stock\s*photo/i,
  /stock\s*image/i,
  /illustration\s*of/i,
  /clipart/i,
  /vector/i,
  /logo/i,
  /icon/i,
  /screenshot/i,
  /meme/i,
];

const BING_SKIP_HOSTS = [
  "th.bing.com",
  "www.bing.com",
  "bing.com",
  "gstatic.com",
  "google.com",
  "encrypted.google.com",
  "pinterest.com",
  "pinterest.co.uk",
  "shutterstock.com",
  "istockphoto.com",
  "gettyimages.com",
  "stock.adobe.com",
  "depositphotos.com",
  "123rf.com",
  "alamy.com",
  "dreamstime.com",
  "vectorstock.com",
  "vecteezy.com",
  "fineartamerica.com",
  "redbubble.com",
  "zazzle.com",
  "teepublic.com",
  "facebook.com",
  "fbcdn.net",
  "instagram.com",
  "cdninstagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
];

export function isAcceptableImageResult(result: { imageUrl?: string; title?: string; link?: string }): boolean {
  const url = (result.imageUrl || "").trim();
  if (!url.startsWith("http")) return false;
  if (url.includes("gstatic.com") || url.includes("google.com")) return false;
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url) && !/format=(jpe?g|png|webp)/i.test(url)) return false;
  const hay = `${result.title || ""} ${result.link || ""}`;
  if (SKIP_DOMAIN_PATTERNS.some((re) => re.test(hay))) return false;
  if (SKIP_TITLE_PATTERNS.some((re) => re.test(hay))) return false;
  return true;
}

/**
 * Parse the murl (image URL) fields out of a Bing Images HTML response.
 * Bing encodes the result list as escaped JSON inside `murl&quot;:&quot;…&quot;`
 * or as an HTML attribute `murl="…"`. Sometimes the URL itself contains
 * escaped slashes (e.g. \u002f).
 */
export function extractBingImageUrls(html: string, max = 15): string[] {
  // Pattern A: escaped JSON — murl&quot;:&quot;URL&quot;
  const jsonRe = /murl&quot;:&quot;((?:https?:|https?:\\u002f)[^&]+?)&quot;/g;
  // Pattern B: HTML attribute — murl="URL"
  const attrRe = /\bmurl="(https?:\/\/[^"]+)"/g;
  const out: string[] = [];
  const seen = new Set<string>();
  const collect = (raw: string) => {
    if (!raw) return;
    let url = raw;
    try {
      url = JSON.parse(`"${raw.replace(/\\u002f/gi, "/")}"`) as string;
    } catch {
      url = raw;
    }
    if (!url || !url.startsWith("http")) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  for (const re of [jsonRe, attrRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      collect(m[1]);
      if (out.length >= max) break;
    }
    if (out.length >= max) break;
  }
  return out;
}

function isAcceptableBingImageUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  for (const skip of BING_SKIP_HOSTS) {
    if (host === skip || host.endsWith(`.${skip}`)) return false;
  }
  if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return false;
  return true;
}

const BING_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Search Bing Images for a real photo. Free — no API key required.
 * Returns the first acceptable image URL (skips stock sites, social, and Bing's own hosts).
 */
export async function searchBingImage(input: {
  headline?: string;
  category?: string;
  topic?: string;
  excerpt?: string;
}): Promise<string | undefined> {
  const query = buildImageSearchQuery(input);
  if (!query) return undefined;

  try {
    const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=30&safeSearch=strict&qft=+filterui:photo-photo`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": BING_USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.bing.com/",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return undefined;
    const html = await response.text();
    const candidates = extractBingImageUrls(html, 25);
    for (const candidate of candidates) {
      if (isAcceptableBingImageUrl(candidate)) return candidate;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
