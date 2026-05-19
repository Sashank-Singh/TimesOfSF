import { XMLParser } from "fast-xml-parser";

interface EventInfo {
  title: string;
  url: string;
  date: string;
  source: string;
}

// ── Luma Scraper ──────────────────────────────────────────────────────

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
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "TimesOfSFBot/1.1 (+https://timesofsf.com)" },
  });
  if (!res.ok) throw new Error(`Luma fetch failed: ${res.status}`);
  const html = await res.text();

  const match = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/);
  if (!match) throw new Error("Could not find __NEXT_DATA__ in Luma page");

  const data = JSON.parse(match[1]);
  const events: LumaEvent[] =
    data?.props?.pageProps?.initialData?.data?.events ?? [];

  const now = new Date();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  return events
    .map((item) => ({
      raw: item,
      start: new Date(item.event.start_at),
    }))
    .filter(({ start }) => start >= now && start <= nextMonth)
    .filter(({ raw }) => {
      const city = raw.event.geo_address_info?.city ?? "";
      return /san francisco/i.test(city);
    })
    .map(({ raw, start }) => ({
      title: raw.event.name,
      url: `https://lu.ma/${raw.event.url}`,
      date: start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      source: "Luma",
    }));
}

// ── Cerebral Valley (Google News RSS) ─────────────────────────────────

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

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
  return extractMatches(
    text,
    /https?:\/\/(?:[\w.-]+\.)?lu\.ma\/[^\s"'<>]+/gi,
  );
}

function parsePubDate(raw?: string): { display: string; date: Date | null } {
  if (!raw) return { display: "Date TBA", date: null };
  const d = new Date(raw);
  if (Number.isFinite(d.getTime())) {
    return {
      display: d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      date: d,
    };
  }
  // Try to fix "Jun 24, 2025" → 2026 (Google News RSS sometimes mislabels year)
  const m = raw.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
  if (m) {
    const fixed = new Date(`${m[1]} ${m[2]}, 2026`);
    if (Number.isFinite(fixed.getTime())) {
      return {
        display: fixed.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        date: fixed,
      };
    }
  }
  return { display: raw, date: null };
}

async function scrapeCerebralValley(): Promise<EventInfo[]> {
  const queries = [
    'site:cerebralvalley.com (San Francisco OR "Bay Area" OR founder OR AI OR startup)',
    '("Cerebral Valley" OR cerebralvalley) (event OR summit OR meetup) San Francisco',
    '"Cerebral Valley" "San Francisco" (summit OR meetup OR hackathon OR conference) -job -career',
    '"Cerebral Valley" startup event',
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
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "TimesOfSFBot/1.1 (+https://timesofsf.com)" },
      });
      if (!response.ok) continue;
      const xml = await response.text();
      const parsed = parser.parse(xml);
      const items = toArray<any>(parsed?.rss?.channel?.item ?? []);

      for (const item of items.slice(0, 10)) {
        const title = item.title?.trim();
        if (!title) continue;

        const link = item.link?.trim() ?? "";
        const blob = `${title} ${item.description ?? ""} ${link}`;
        const cerebralUrls = extractCerebralValleyUrls(blob);
        const lumaUrls = extractLumaUrls(blob);

        // Prefer cerebralvalley.com URLs, then Luma URLs found in description, then article link
        const primaryUrl =
          cerebralUrls[0] ||
          lumaUrls[0] ||
          (/cerebral/i.test(title) ? link : "");

        if (!primaryUrl || !primaryUrl.startsWith("http")) continue;

        const normalized = primaryUrl.split("?")[0].replace(/\/$/, "");
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const { display } = parsePubDate(item.pubDate);

        collected.push({
          title: title.replace(/\s+-\s+[^-]+$/, "").trim(),
          url: primaryUrl,
          date: display,
          source: "Cerebral Valley",
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

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Scraping Luma SF events...");
  const lumaEvents = await scrapeLumaSf();
  console.log(`Found ${lumaEvents.length} Luma events\n`);

  console.log("Scraping Cerebral Valley events...");
  const cvEvents = await scrapeCerebralValley();
  console.log(`Found ${cvEvents.length} Cerebral Valley events\n`);

  const all = [...lumaEvents, ...cvEvents];
  console.log("═".repeat(60));
  console.log("ALL EVENTS:");
  console.log("═".repeat(60));
  all.forEach((e, i) => {
    console.log(`${i + 1}. [${e.source}] ${e.title}`);
    console.log(`   ${e.date} — ${e.url}\n`);
  });
}

main().catch(console.error);
