import { XMLParser } from "fast-xml-parser";
import { config } from "./config";

export interface EventInfo {
  title: string;
  url: string;
  date: string;
  source: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

interface RssItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchFeedXml(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    headers: { "user-agent": "TimesOfSFBot/1.1 (+https://timesofsf.onrender.com)" },
  });
  if (!response.ok) throw new Error(`RSS fetch failed ${response.status}`);
  return response.text();
}

function extractUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/(?:[\w.-]+\.)?lu\.ma\/[^\s"'<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0].replace(/[),.]+$/, ""));
  }
  return out;
}

function classifyEventSource(url: string, title: string): string {
  const t = title.toLowerCase();
  if (/cerebral\s+valley/.test(t)) return "Cerebral Valley";
  if (url.includes("lu.ma") || url.includes("luma.co")) return "Luma";
  if (/cerebral/.test(t)) return "Cerebral Valley";
  return "Events wire";
}

function parsePubDate(raw?: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : raw;
}

/**
 * Prefer real cal links (lu.ma) parsed from RSS — avoids hallucinated URLs from LLMs.
 */
export async function fetchEvents(): Promise<EventInfo[]> {
  const queries = [
    "site:lu.ma (San Francisco OR SF OR Oakland) (startup OR founder OR AI OR tech OR VC)",
    "site:lu.ma (Silicon Valley OR Palo Alto OR Sunnyvale OR \"San Jose\") (startup OR AI OR founder)",
    '("Cerebral Valley" OR cerebralvalley) (event OR summit OR meetup)',
  ];

  const collected: EventInfo[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const url =
      "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-US&gl=US&ceid=US:en";
    try {
      const xml = await fetchFeedXml(url);
      const parsed = parser.parse(xml);
      const items = toArray<RssItem>(parsed?.rss?.channel?.item ?? []);

      for (const item of items.slice(0, 14)) {
        const title = item.title?.trim();
        if (!title) continue;

        const link = item.link?.trim() ?? "";
        const blob = `${title} ${item.description ?? ""} ${link}`;
        const lumaUrls = extractUrlsFromText(blob);

        const primaryUrl =
          lumaUrls[0] ||
          (link.includes("lu.ma") || link.includes("luma.co") ? link : "") ||
          (/cerebral/i.test(title) ? link : "");

        if (!primaryUrl || !primaryUrl.startsWith("http")) continue;

        const normalized = primaryUrl.split("?")[0].replace(/\/$/, "");
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        collected.push({
          title: title.replace(/\s+-\s+[^-]+$/, "").trim(),
          url: primaryUrl,
          date: parsePubDate(item.pubDate) || "Date TBA",
          source: classifyEventSource(primaryUrl, title),
        });

        if (collected.length >= 12) break;
      }
    } catch (err) {
      console.error("Event RSS fetch failed:", err);
    }

    if (collected.length >= 12) break;
  }

  return collected.slice(0, 10);
}
