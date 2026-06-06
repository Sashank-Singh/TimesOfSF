import { XMLParser } from "fast-xml-parser";
import { config } from "./config";
import { normalizeHeadline } from "./dedupe";
import {
  ALL_EDITORIAL_CATEGORIES,
  EditorialCategory,
  PreferredSourceName,
  TrendCandidate,
} from "./types";
import { getSourceMetadata, SOURCE_REGISTRY, withSourceMetadata } from "./sourceRegistry";

function normalizePublisherToken(raw: string) {
  return raw.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
}

/** Map Google News title suffix ("… — Publisher") to a known masthead when possible. */
function inferPublisherFromGoogleNewsTitle(title: string): PreferredSourceName {
  const parts = title.split(/\s-\s+/);
  const pub = parts.length > 1 ? parts[parts.length - 1].trim() : "";
  const norm = normalizePublisherToken(pub);
  if (!norm) return "Reuters";

  const hit = SOURCE_REGISTRY.find((s) =>
    [s.name, ...(s.aliases ?? [])].some((a) => normalizePublisherToken(a) === norm),
  );
  return hit?.name ?? "Reuters";
}

function deriveNormalizedTopic(headline: string) {
  return normalizeHeadline(headline.replace(/[-|:].*$/, "").trim());
}

type LaneFeed = {
  url: string;
};

/** Priority feeds used to synthesize “quota” stories when a lane has been quiet for 24h. */
export const LANE_QUOTA_FEEDS: Record<Exclude<EditorialCategory, "Events" | "GitHub Top">, LaneFeed[]> = {
  Tech: [{ url: "https://techcrunch.com/feed/" }, { url: "https://www.theverge.com/rss/index.xml" }],
  Funding: [
    { url: "https://techcrunch.com/category/startups/feed/" },
    { url: "https://techcrunch.com/funding/feed/" },
    { url: "https://feeds.bloomberg.com/technology/news.rss" },
  ],
  Civics: [{ url: "https://sfstandard.com/feed/" }, { url: "https://missionlocal.org/feed/" }],
  Culture: [
    { url: "https://sfstandard.com/feed/" },
    { url: "https://www.sfchronicle.com/entertainment/feed/" },
  ],
  Transit: [
    { url: "https://www.sfchronicle.com/bayarea/feed/Bay-Area-News-106.php" },
    { url: "https://sfstandard.com/feed/" },
  ],
  Food: [
    {
      url:
        "https://news.google.com/rss/search?q=" +
        encodeURIComponent(
          '(founder OR founders OR startup OR YC OR "Y Combinator" OR a16z OR "Andreessen Horowitz" OR VC OR "venture capital") ' +
            '(cafe OR coffee OR restaurant OR dining OR bakery OR sommelier) ' +
            '("San Francisco" OR "Bay Area" OR "Silicon Valley" OR "Palo Alto" OR "Menlo Park" OR "Mountain View" OR Sunnyvale OR "San Jose")',
        ) +
        "&hl=en-US&gl=US&ceid=US:en",
    },
  ],
};

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

/** Only tech-native mastheads—do not treat Reuters/BBC/etc. as “tech desk” by outlet alone. */
const TECH_NATIVE_OUTLETS = new Set<PreferredSourceName>(["TechCrunch", "The Verge", "Engadget"]);

function haystackFor(candidate: TrendCandidate) {
  return normalizeHeadline(
    [candidate.topic, candidate.normalizedTopic, ...(candidate.sampleHeadlines ?? [])].filter(Boolean).join(" "),
  );
}

const LOCAL_OUTLETS = new Set<PreferredSourceName>([
  "The San Francisco Standard",
  "Mission Local",
  "San Francisco Chronicle",
]);

/** Higher = stronger Bay Area / SF relevance for ranking (does not change desk classification). */
export function topicBayAreaAffinityScore(candidate: TrendCandidate): number {
  const raw = [candidate.topic, candidate.normalizedTopic, ...(candidate.sampleHeadlines ?? [])].join(" ").toLowerCase();
  let score = 0;
  if (
    /\b(san francisco|\bsf\b|bay area|silicon valley|oakland|berkeley|alameda|marin|san mateo county|san jose|palo alto|menlo park|mountain view|sunnyvale|redwood city|cupertino|fremont|peninsula|east bay|north bay|tenderloin|mission district|caltrain|muni|\bbart\b|transbay|golden gate)\b/.test(
      raw,
    )
  ) {
    score += 44;
  }
  for (const s of candidate.signalSources ?? []) {
    if (LOCAL_OUTLETS.has(s)) score += 26;
  }
  return score;
}

/** Cross-outlet buzz + high-salience global / breaking patterns (still grounded in sources). */
export function topicMajorGlobalAffinityScore(candidate: TrendCandidate): number {
  const text = haystackFor(candidate).toLowerCase();
  let score = 0;
  if (
    /\b(war|invasion|ceasefire|nato|pentagon|earthquake|tsunami|hurricane|tornado|pandemic|outbreak|hostages|evacuation|nuclear test|missile strike|magnitude\s*\d)\b/.test(
      text,
    )
  ) {
    score += 78;
  }
  if (
    /\b(supreme court|white house|united nations|security council|federal reserve|interest rates|currency crisis|stock market crash|prime minister)\b/.test(
      text,
    )
  ) {
    score += 48;
  }
  score += Math.min((candidate.signalCount ?? 0) * 17, 75);
  return score;
}

/** Obvious tech-industry signal beyond desk routing. */
export function topicTechBeatScore(candidate: TrendCandidate): number {
  const text = haystackFor(candidate);
  if (
    /\b(ai|artificial intelligence|machine learning|llm|openai|anthropic|gemini|gpt|nvidia|gpu|chip|semiconductor|datacenter|cloud|saas|cyber|ransomware|startup|venture|series [a-z]|ipo|acquires|acquisition|layoffs)\b/i.test(
      text,
    )
  ) {
    return 30;
  }
  return 0;
}

/**
 * Route each trending bucket into a desk. Funding/transit/civics keywords win before generic tech.
 */
export function classifyEditorialCategory(candidate: TrendCandidate): EditorialCategory {
  if (candidate.editorialCategory) return candidate.editorialCategory;

  const text = haystackFor(candidate);
  const headBlob = [candidate.topic, candidate.normalizedTopic, ...(candidate.sampleHeadlines ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(series\s+[a-z]|ipo|spac|valuation|acquisition|merger|investment|investors|venture|funding|raised\s+\$|raises\s+\$|seed\s+round|growth\s+round)\b/.test(
      text,
    )
  ) {
    return "Funding";
  }

  if (/\b(muni|bart|caltrain|clipper|transit|traffic\s+lane|bridge\s+toll|highway|street\s+closure|sidewalk)\b/.test(text)) {
    return "Transit";
  }

  if (
    /\b(mayor|supervisor|ballot|housing\s+element|board\s+of\s+supervisors|city\s+council|ordinance|policy|election|attorney general|redistricting|supreme court|governor|state legislature|federal court|indictment|impeachment)\b/.test(
      text,
    ) ||
    /\b(attorney general|redistricting|supreme court|governor|state legislature|federal court|indictment|impeachment)\b/.test(headBlob) ||
    /\b\w+\s+ag\s+/i.test(headBlob)
  ) {
    return "Civics";
  }

  if (/\b(museum|gallery|festival|concert|film\s+festival|ballet|opera|theater|arts)\b/.test(text)) {
    return "Culture";
  }

  if (
    /\b(cafe|coffee|restaurant|chef|dining|bakery|wine\s+bar|supper\s+club)\b/.test(text) &&
    /\b(sf|san francisco|bay\s+area|silicon valley|palo alto|menlo|mountain view|sunnyvale|san jose|peninsula)\b/.test(text)
  ) {
    return "Food";
  }

  const techSignals =
    /\b(ai|machine learning|llm|gpu|chip|software|cloud|saas|cyber|startup|founder|venture|tech)\b/.test(text) ||
    (candidate.signalSources ?? []).some((s) => TECH_NATIVE_OUTLETS.has(s));

  if (techSignals) return "Tech";

  return "Tech";
}

export type ExistingPostSummary = {
  topic?: string | null;
  headline?: string | null;
  category?: string | null;
  created_at?: Date | string | null;
};

function parseCreatedAt(raw: Date | string | null | undefined): number {
  if (!raw) return 0;
  const t = typeof raw === "string" ? Date.parse(raw) : raw.getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Categories with no successful publish in the last `windowMs` milliseconds. */
export function getStaleCategories(existing: ExistingPostSummary[], windowMs: number): EditorialCategory[] {
  const cutoff = Date.now() - windowMs;
  const latestByCategory = new Map<EditorialCategory, number>();

  for (const cat of ALL_EDITORIAL_CATEGORIES) {
    latestByCategory.set(cat, 0);
  }

  for (const row of existing) {
    const cat = row.category as EditorialCategory | undefined;
    if (!cat || !latestByCategory.has(cat)) continue;
    const ts = parseCreatedAt(row.created_at ?? null);
    if (ts > (latestByCategory.get(cat) ?? 0)) {
      latestByCategory.set(cat, ts);
    }
  }

  const stale: EditorialCategory[] = [];
  for (const [cat, latest] of latestByCategory) {
    if (latest < cutoff) stale.push(cat);
  }
  return stale;
}

async function fetchFeedXml(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
    headers: { "user-agent": `TimesOfSFBot/1.1 (+${config.appUrl})` },
  });
  if (!response.ok) throw new Error(`RSS fetch failed ${response.status}`);
  return response.text();
}

/** Pull one fresh headline for a lane to satisfy frequent desk quotas. */
export async function fetchQuotaSeedCandidate(
  category: Exclude<EditorialCategory, "Events" | "GitHub Top">,
  existing: ExistingPostSummary[] = [],
): Promise<TrendCandidate | null> {
  const feeds = LANE_QUOTA_FEEDS[category];
  for (const feed of feeds) {
    try {
      const xml = await fetchFeedXml(feed.url);
      const parsed = parser.parse(xml);
      const items = toArray<RssItem>(parsed?.rss?.channel?.item ?? parsed?.feed?.entry ?? []);

      for (const item of items.slice(0, 10)) {
        if (!item?.title?.trim() || !item.link?.trim()) continue;

        const title = item.title.trim();
        const normalizedTopic = deriveNormalizedTopic(title);
        if (!normalizedTopic || normalizedTopic.length < 8) continue;

        const sourceName =
          feed.url.includes("news.google.com") ? inferPublisherFromGoogleNewsTitle(title) : inferLaneDefaultSource(category, feed.url);

        const meta = getSourceMetadata(sourceName);
        const primary = withSourceMetadata(
          {
            sourceName,
            articleUrl: item.link.trim(),
            headline: title,
            publishedAt: item.pubDate,
            summary: item.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          },
          meta,
        );

        const candidate = {
          topic: title.replace(/\s+-\s*[^-]+$/, "").trim(),
          normalizedTopic,
          signalCount: 1,
          signalSources: [sourceName],
          sampleHeadlines: [title],
          primarySource: primary,
          editorialCategory: category,
          quotaSeed: true,
        } satisfies TrendCandidate;

        if (!topicAlreadyPublished(candidate, existing)) return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function inferLaneDefaultSource(category: Exclude<EditorialCategory, "Events" | "GitHub Top">, feedUrl: string): PreferredSourceName {
  if (feedUrl.includes("techcrunch.com")) return "TechCrunch";
  if (feedUrl.includes("theverge.com")) return "The Verge";
  if (feedUrl.includes("bloomberg.com")) return "Bloomberg";
  if (feedUrl.includes("sfstandard.com")) return "The San Francisco Standard";
  if (feedUrl.includes("missionlocal.org")) return "Mission Local";
  if (feedUrl.includes("sfchronicle.com")) return "San Francisco Chronicle";
  if (category === "Tech") return "TechCrunch";
  return "Reuters";
}

export function topicAlreadyPublished(candidate: TrendCandidate, existing: ExistingPostSummary[]): boolean {
  const candNorm = candidate.normalizedTopic;
  const candHead = normalizeHeadline(candidate.topic);
  return existing.some((p) => {
    const pt = normalizeHeadline(p.topic || "");
    const ph = normalizeHeadline(p.headline || "");
    return (
      (p.topic && p.topic === candidate.topic) ||
      (pt && pt === candNorm) ||
      (ph && ph === candHead) ||
      (pt && candNorm && pt === candNorm)
    );
  });
}

/**
 * Quota seeds for quiet desks run first. Organic topics rank by desk + Bay Area/tech affinity + major-global lift.
 */
export function prioritizeCandidates(candidates: TrendCandidate[]): TrendCandidate[] {
  const seeds = candidates.filter((c) => c.quotaSeed);
  const organic = candidates.filter((c) => !c.quotaSeed);

  const rank = (c: TrendCandidate) => {
    const cat = classifyEditorialCategory(c);
    const deskBoost =
      cat === "Tech"
        ? 50
        : cat === "Funding"
          ? 36
          : cat === "Civics" || cat === "Transit"
            ? 28
            : cat === "Culture" || cat === "Food"
              ? 22
              : 0;
    const base = deskBoost + c.signalCount * 4 + Math.min((c.sampleHeadlines?.length ?? 0) * 2, 10);
    return (
      base +
      topicBayAreaAffinityScore(c) +
      topicTechBeatScore(c) +
      topicMajorGlobalAffinityScore(c)
    );
  };

  organic.sort((a, b) => rank(b) - rank(a));
  seeds.sort((a, b) => (a.editorialCategory ?? "").localeCompare(b.editorialCategory ?? ""));
  return [...seeds, ...organic];
}
