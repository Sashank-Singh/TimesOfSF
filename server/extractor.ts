import { SourceExtraction, SourceSearchResult } from "./types";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { config } from "./config";

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
    facts: [searchResult.summary].filter(Boolean) as string[],
  };
}

function resolvePythonBinary(): string {
  const candidates = [
    path.resolve(process.cwd(), "venv", "bin", "python3"),
    path.resolve(process.cwd(), "venv", "bin", "python3.14"),
    path.resolve(process.cwd(), "venv", "bin", "python3.13"),
    path.resolve(process.cwd(), "venv", "bin", "python"),
  ];
  const hit = candidates.find((p) => fs.existsSync(p));
  return hit ?? "python3";
}

async function runPythonExtractor(url: string): Promise<any> {
  const pythonBin = resolvePythonBinary();
  const scriptPath = path.resolve(process.cwd(), "server", "extractor.py");

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn(pythonBin, [scriptPath, url], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let result = "";
    let stderrBuf = "";

    pythonProcess.stdout.on("data", (data) => {
      result += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      stderrBuf += data.toString();
    });

    pythonProcess.on("close", (code) => {
      const parseStdoutJson = (): { ok?: boolean; error?: string; title?: string; text?: string } | null => {
        const jsonMatch = result.match(/(\{[\s\S]*\})/);
        if (!jsonMatch) return null;
        try {
          return JSON.parse(jsonMatch[1]) as { ok?: boolean; error?: string; title?: string; text?: string };
        } catch {
          return null;
        }
      };

      const parsed = parseStdoutJson();

      if (parsed && parsed.ok === false) {
        reject(new Error(parsed.error || "News-please extraction failed"));
        return;
      }

      if (parsed && parsed.ok === true && parsed.text) {
        resolve(parsed);
        return;
      }

      // Legacy: JSON without `ok` but with body text
      if (parsed && parsed.title && parsed.text) {
        resolve(parsed);
        return;
      }

      if (code !== 0) {
        const hint = stderrBuf.trim() || result.trim().slice(0, 400) || "(no output)";
        reject(new Error(`Python exited ${code}: ${hint}`));
        return;
      }

      reject(new Error(`No usable JSON from extractor: ${result.slice(0, 400)}`));
    });
  });
}

export async function extractSource(searchResult: SourceSearchResult): Promise<SourceExtraction> {
  const rssThumb =
    searchResult.imageUrl && searchResult.imageUrl.startsWith("http") ? searchResult.imageUrl : "";

  if (config.disableNewsPlease) {
    return buildFallbackExtraction(searchResult);
  }

  try {
    const article = await runPythonExtractor(searchResult.articleUrl);
    
    // Split text into paragraphs for fact building
    const paragraphs = article.text
      .split(/\n\s*\n/)
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 80)
      .slice(0, 8);

    const facts = buildFacts(article.title, paragraphs);

    return {
      sourceName: searchResult.sourceName,
      sourceId: searchResult.sourceId,
      sourceType: searchResult.sourceType,
      reliabilityTier: searchResult.reliabilityTier,
      allowedUse: searchResult.allowedUse,
      articleUrl: searchResult.articleUrl,
      canonicalUrl: searchResult.articleUrl,
      headline: article.title || searchResult.headline,
      imageUrl: (article.imageUrl && String(article.imageUrl).startsWith("http") ? article.imageUrl : "") || rssThumb,
      publishedAt: article.publishedAt || searchResult.publishedAt,
      summary: article.title || searchResult.headline,
      textExcerpt: article.text.slice(0, 1200),
      facts,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const quietFailure =
      /no main text extracted|newsplease returned no article|^NewsPlease\b/i.test(msg) ||
      /newsplease extraction failed$/i.test(msg);
    if (!quietFailure) {
      console.warn("News-please extraction failed, falling back to basic metadata:", msg);
    }
    return buildFallbackExtraction(searchResult);
  }
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
