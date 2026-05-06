import { SourceExtraction, SourceSearchResult } from "./types";
import { spawn } from "child_process";
import path from "path";

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

async function runPythonExtractor(url: string): Promise<any> {
  const venvPath = path.resolve(process.cwd(), "venv", "bin", "python3");
  const scriptPath = path.resolve(process.cwd(), "server", "extractor.py");

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn(venvPath, [scriptPath, url]);
    let result = '';
    let error = '';
    
    pythonProcess.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(error || `Python process failed with code ${code}`));
      } else {
        try {
          // Find the last JSON block in stdout to ignore any preceding warnings
          const jsonMatch = result.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[1]));
          } else {
            reject(new Error(`No JSON found in Python output: ${result}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Python output: ${result}`));
        }
      }
    });
  });
}

export async function extractSource(searchResult: SourceSearchResult): Promise<SourceExtraction> {
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
      articleUrl: searchResult.articleUrl,
      canonicalUrl: searchResult.articleUrl,
      headline: article.title || searchResult.headline,
      imageUrl: article.imageUrl || "",
      publishedAt: article.publishedAt || searchResult.publishedAt,
      summary: article.title || searchResult.headline,
      textExcerpt: article.text.slice(0, 3000),
      facts,
    };
  } catch (error) {
    console.error("News-please extraction failed, falling back to basic metadata:", error);
    // Minimal fallback if Python fails
    return {
      sourceName: searchResult.sourceName,
      articleUrl: searchResult.articleUrl,
      canonicalUrl: searchResult.articleUrl,
      headline: searchResult.headline,
      imageUrl: "",
      publishedAt: searchResult.publishedAt,
      summary: searchResult.headline,
      textExcerpt: searchResult.summary || "",
      facts: [searchResult.summary].filter(Boolean) as string[],
    };
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
