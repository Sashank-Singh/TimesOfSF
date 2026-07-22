import { XMLParser } from "fast-xml-parser";
import { config } from "./config";

export interface EventInfo {
  title: string;
  url: string;
  date: string;
  source: string;
}


/** Calendar YYYY-MM-DD in America/Los_Angeles. */
export function sfTodayYmd(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Parse display dates like "Jul 19, 2026" into YYYY-MM-DD (null if unknown). */
export function parseEventYmd(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^date\s*tba$/i.test(trimmed) || /^tba$/i.test(trimmed)) return null;
  const d = new Date(trimmed);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  // Guard absurd years from bad RSS labels
  if (y < 2024 || y > 2100) return null;
  return `${y}-${m}-${day}`;
}

/** Keep events from SF today through +7 days, sorted soonest first. */
export function filterEventsNextWeek<T extends { date: string }>(
  events: T[],
  now = new Date(),
  daysAhead = 7,
): T[] {
  const start = sfTodayYmd(now);
  const end = addDaysYmd(start, daysAhead);
  return events
    .map((event) => ({ event, ymd: parseEventYmd(event.date) }))
    .filter((row): row is { event: T; ymd: string } => !!row.ymd && row.ymd >= start && row.ymd <= end)
    .sort((a, b) => a.ymd.localeCompare(b.ymd) || a.event.date.localeCompare(b.event.date))
    .map((row) => row.event);
}

// ── Luma (direct page scrape) ─────────────────────────────────────────

interface LumaEvent {
  event: {
    name: string;
    url: string;
    start_at: string;
    end_at: string;
    geo_address_info?: {
      city?: string;
      city_state?: string;
    };
  };
  start_at: string;
}

async function scrapeLumaSf(): Promise<EventInfo[]> {
  const res = await fetch("https://luma.com/sf", {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    headers: { "User-Agent": `TimesOfSFBot/1.1 (+${config.appUrl})` },
  });
  if (!res.ok) throw new Error(`Luma fetch failed: ${res.status}`);
  const html = await res.text();

  const match = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/);
  if (!match) throw new Error("Could not find __NEXT_DATA__ in Luma page");

  const data = JSON.parse(match[1]);
  const events: LumaEvent[] =
    data?.props?.pageProps?.initialData?.data?.events ?? [];

  const mapped = events
    .map((item) => ({ raw: item, start: new Date(item.event.start_at) }))
    .filter(({ start }) => Number.isFinite(start.getTime()))
    .filter(({ raw }) => {
      const city = raw.event.geo_address_info?.city ?? "";
      return /san francisco/i.test(city);
    })
    .map(({ raw, start }) => ({
      title: raw.event.name,
      url: `https://lu.ma/${raw.event.url}`,
      date: start.toLocaleDateString("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      source: "Luma",
    }));

  return filterEventsNextWeek(mapped);
}

// ── Cerebral Valley (Google News RSS) ─────────────────────────────────

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

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

function extractMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  const flags = re.global ? re.flags : `${re.flags}g`;
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    out.push(m[0].replace(/[),.]+$/, ""));
  }
  return out;
}

function extractCerebralValleyUrls(text: string): string[] {
  return extractMatches(
    text,
    /https?:\/\/(?:[\w.-]+\.)?cerebralvalley\.[a-z]{2,}\/[^\s"'<>]+/gi,
  );
}

function extractLumaUrls(text: string): string[] {
  return extractMatches(text, /https?:\/\/(?:[\w.-]+\.)?lu\.ma\/[^\s"'<>]+/gi);
}

function parsePubDate(raw?: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isFinite(d.getTime())) {
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  // Google News RSS sometimes labels the year incorrectly; try 2026
  const m = raw.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
  if (m) {
    const fixed = new Date(`${m[1]} ${m[2]}, 2026`);
    if (Number.isFinite(fixed.getTime())) {
      return fixed.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return raw;
}

function classifyEventSource(url: string, title: string): string {
  if (/cerebralvalley\./i.test(url)) return "Cerebral Valley";
  const t = title.toLowerCase();
  if (/cerebral\s+valley/.test(t)) return "Cerebral Valley";
  if (/cerebral/.test(t)) return "Cerebral Valley";
  return "Events wire";
}

async function scrapeCerebralValley(): Promise<EventInfo[]> {
  const queries = [
    'site:cerebralvalley.com (San Francisco OR "Bay Area" OR founder OR AI OR startup)',
    '("Cerebral Valley" OR cerebralvalley) (event OR summit OR meetup) San Francisco',
    '"Cerebral Valley" "San Francisco" (summit OR meetup OR hackathon OR conference) -job -career',
  ];

  const collected: EventInfo[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const url =
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(q) +
      "&hl=en-US&gl=US&ceid=US:en";
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.sourceTimeoutMs),
        headers: { "user-agent": `TimesOfSFBot/1.1 (+${config.appUrl})` },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const parsed = parser.parse(xml);
      const items = toArray<RssItem>(parsed?.rss?.channel?.item ?? []);

      for (const item of items.slice(0, 10)) {
        const title = item.title?.trim();
        if (!title) continue;

        const link = item.link?.trim() ?? "";
        const blob = `${title} ${item.description ?? ""} ${link}`;
        const cerebralUrls = extractCerebralValleyUrls(blob);
        const lumaUrls = extractLumaUrls(blob);

        const primaryUrl =
          cerebralUrls[0] ||
          lumaUrls[0] ||
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

        if (collected.length >= 6) break;
      }
    } catch (err) {
      console.error("Cerebral Valley RSS fetch failed:", err);
    }
    if (collected.length >= 6) break;
  }

  return collected.slice(0, 6);
}

// ── Combined export ───────────────────────────────────────────────────

export async function fetchEvents(): Promise<EventInfo[]> {
  const results: EventInfo[] = [];
  const seen = new Set<string>();

  // Primary: direct Luma scrape
  try {
    const lumaEvents = await scrapeLumaSf();
    for (const e of lumaEvents) {
      const key = e.url.split("?")[0].replace(/\/$/, "");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(e);
      }
    }
  } catch (err) {
    console.error("Luma scraper failed:", err);
  }

  // Secondary: Cerebral Valley RSS
  try {
    const cvEvents = await scrapeCerebralValley();
    for (const e of cvEvents) {
      const key = e.url.split("?")[0].replace(/\/$/, "");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(e);
      }
    }
  } catch (err) {
    console.error("Cerebral Valley scraper failed:", err);
  }

  return filterEventsNextWeek(results).slice(0, 24);
}
