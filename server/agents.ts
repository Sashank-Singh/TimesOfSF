import crypto from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { config } from "./config";
import { classifyEditorialCategory } from "./editorial";
import { normalizeUrl } from "./dedupe";
import type { EventInfo } from "./events";
import { EditorialCategory, GeneratedPost, SourceExtraction, TrendCandidate } from "./types";

const geminiAi = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

function clampPromptText(raw: string, maxChars: number): string {
  if (!raw) return "";
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…`;
}

/** Shrink / clean source payloads so the model is less likely to emit broken JSON when paraphrasing them. */
function sanitizeSourcesForPrompt(sources: SourceExtraction[], compact: boolean): SourceExtraction[] {
  const maxFacts = compact ? 5 : 8;
  const maxExcerpt = compact ? 2200 : 3200;
  return sources.map((s) => ({
    ...s,
    headline: clampPromptText(s.headline, 400),
    summary: clampPromptText(s.summary, compact ? 900 : 1200),
    textExcerpt: clampPromptText(s.textExcerpt, maxExcerpt),
    facts: (s.facts ?? []).slice(0, maxFacts).map((f) => clampPromptText(f, compact ? 420 : 550)),
  }));
}

type PromptMode = "full" | "compact";

function parseModelJson(raw: string, context: string): unknown {
  const trimmed = raw.trim();
  const attempts: Array<{ label: string; fn: () => unknown }> = [
    { label: "direct", fn: () => JSON.parse(trimmed) },
    { label: "jsonrepair-full", fn: () => JSON.parse(jsonrepair(trimmed)) },
    {
      label: "slice",
      fn: () => {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("No JSON object found");
        return JSON.parse(trimmed.slice(start, end + 1));
      },
    },
    {
      label: "jsonrepair-slice",
      fn: () => {
        const start = trimmed.indexOf("{");
        const end = trimmed.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("No JSON object found");
        return JSON.parse(jsonrepair(trimmed.slice(start, end + 1)));
      },
    },
  ];

  let lastMessage = "unknown";
  for (const { label, fn } of attempts) {
    try {
      return fn();
    } catch (err) {
      lastMessage = `${label}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  throw new Error(`${context} — ${lastMessage}`);
}

export interface PreviousCoverage {
  topic: string;
  headline: string;
  keyFacts: string[];
  publishedAt: Date;
}

function buildPrompt(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  mode: PromptMode,
  previousCoverage?: PreviousCoverage[],
): string {
  const desk: EditorialCategory = topic.editorialCategory ?? classifyEditorialCategory(topic);
  const deskNotes =
    desk === "GitHub Top"
      ? "Desk focus: fast-rising GitHub repositories, what they do, the developer problem they solve, and why they are drawing attention."
      : desk === "Food"
        ? "Desk focus: Bay Area food & hospitality stories tied to founders, startups, investors, and tech-industry culture—not generic tourist spots."
        : desk === "Funding"
        ? "Desk focus: venture financings, M&A, IPOs, cap tables, and macro implications for builders."
        : desk === "Transit"
          ? "Desk focus: SF Bay mobility—Muni, BART, Caltrain, bridges, traffic policy, and infrastructure delivery."
          : desk === "Civics"
            ? "Desk focus: SF / Bay governance, housing, elections, civic accountability."
            : desk === "Culture"
              ? "Desk focus: arts, institutions, and civic life that shape the region."
              : "Desk focus: technology industry, semiconductors, AI, cybersecurity, and platform economics.";

  const compact = mode === "compact";
  const lengthGuide = compact
    ? "TARGET LENGTH: ~850–1,100 words total. Keep paragraphs tight so JSON stays valid."
    : "TARGET LENGTH: ~1,200–1,700 words. This is a magazine-style feature, not a bullet recap.";
  const entityGuide = compact
    ? "MANDATORY: Use [[Bracketed Terms]] for at least 8 entities. The entities array must define each bracketed term."
    : "MANDATORY: Use [[Bracketed Terms]] for at least 12 entities. The entities array must define each bracketed term.";
  const citationGuide = compact
    ? "citations: at most 4 objects—only for claims you explicitly support in the prose. quoteOrFact = ONE short line (≤ 160 chars)."
    : "citations: at most 6 objects—only for claims grounded in the narrative. Skip outlets you did not rely on.";

  return [
    "You are the Senior Executive Editor of the Times of SF.",
    `You are filing for the ${desk} desk. ${deskNotes}`,
    lengthGuide,
    "Write with analytical authority, but stay strictly grounded in the provided source facts.",
    "CRITICAL: Do NOT invent or 'tailor' details to specific San Francisco neighborhoods unless they appear in the source packets.",
    "AUDIENCE PRIORITY: When sources include Bay Area or Silicon Valley specifics, foreground them for SF readers. When the story is major national or global breaking news with no Bay Area material in the packets, report it clearly for impact—do not invent local color.",
    "CRITICAL: SINGLE-TOPIC DISCIPLINE — Cover ONLY the specific company, person, product, or event named in the headline topic. The source packets may contain unrelated stories about other companies, funding rounds, or people. You MUST IGNORE those unrelated entries. Do NOT mention, compare to, or list other companies or events that are not directly part of this one story. A reader should never see an article titled about Topic A that also discusses Topic B, C, and D.",
    "Avoid flowery filler, clickbait, fake certainty, and hype phrases like 'shocking' or 'you won't believe'.",
    "Do not say the story is based on '200+ sources'; cite only the sources actually provided.",
    "COPYRIGHT SAFETY — EXTREME PARAPHRASING REQUIRED: You must rewrite every fact from scratch in your own words. Read a sentence from the source, then look away and write it from memory using completely different sentence structure and vocabulary. NEVER reuse a sequence of 5+ consecutive words that appears in any source. Change the grammatical subject, restructure clauses, use synonyms, and vary sentence openings. If our automated copyright check finds any 8-word phrase matching a source, the article is REJECTED and discarded permanently. This is the single most important rule — it overrides style, length, and formatting goals.",
    "Every factual claim must map to a source credit. Use inline citations like (Reuters) after specific factual claims.",
    "Separate confirmed facts from analysis. Label uncertainty plainly.",
    "Prefer primary documents, official statements, filings, and public data when present in the source packets.",
    "Structure bodyMarkdown using ### headers in this EXACT order:",
    "### The Dispatch: The Immediate News and Its Primary Impact",
    "### The Context: Historical Background and Broader Industry Trends",
    "### The Data Insight: A Rigorous Analysis of the Underlying Numbers",
    "### The Horizon: Long-Term Implications and the Future Outlook",
    "### Source Notes",
    "CRITICAL: entities and dataBlocks arrays MUST NOT be empty. If you return empty arrays the article will be rejected.",
    "The Dispatch leads with what happened and why readers should care now. The Context focuses ONLY on the same specific company, person, product, or event from The Dispatch — do NOT expand into unrelated companies, sectors, or funding rounds that are not directly part of this story. The Data Insight focuses on quantitative interpretation—ONLY when the sources supply at least TWO comparable numeric facts worth plotting. If there is nothing meaningful to chart, write analytic prose only: set dataBlocks to [] and do NOT insert any [CHART:N] tokens anywhere. When you do chart, insert [CHART:0] exactly once inside The Data Insight and ensure dataBlocks[0] matches those numbers.",
    "Use rich paragraphs; bullet lists only where density demands it.",
    "Entity definitions must be plain-English, jargon-free, and written for non-experts; for each entity, add a short sentence explaining how the term functions in this article (not just a dictionary definition).",
    "NEVER emit a [[Bracketed Term]] in bodyMarkdown without a matching {name, definition} object in entities[]. Every bracketed term must have a real, non-empty definition (no placeholders, no '?', no 'TBD'). If you do not have a real definition, do NOT bracket the term.",
    "Only bracket terms that a smart reader might not know on sight: acronyms (UAP, ARR, SPAC), companies / products / programs, named people, niche technical concepts, named statutes/agencies, named locations like neighborhoods, named investors/funds. Do NOT bracket everyday English words (e.g. 'helicopter', 'company', 'industry', 'data') or generic geographic terms (e.g. 'California', 'America', 'the West Coast').",
    "When charts are warranted: use bar, histogram, scatter, or line. Line for time series; scatter for disconnected points.",
    "Each dataBlock needs type, title, xAxisLabel, yAxisLabel, and data.",
    "For bar/histogram use {label, value}. For scatter/line use numeric {x, y, label}.",
    "Chart axes must name real dimensions (e.g. Quarter and Revenue ($M)); never use Category/Value placeholders.",
    "credits must ONLY list outlets you actually cite or link to inside bodyMarkdown. Omit every unused RSS packet.",
    "OUTPUT RULES: Reply with ONE JSON object only. Escape double-quotes inside strings as \\\" and use \\n for newlines—never output raw multi-line strings inside JSON.",
    `Return JSON keys: headline, slug, dek, bodyMarkdown, shortPost, credits, citations, entities, dataBlocks, editorialCategory, tldr.`,
    `editorialCategory must be one of: Tech, Funding, Civics, Culture, Transit, Food, Events, GitHub Top — prefer "${desk}" unless sources clearly belong elsewhere.`,
    "credits: include sourceName, articleUrl, sourceType, publishedAt when known, confidence, factBullets — one row per outlet you truly used.",
    "citations must be an array of {claim, sourceName, sourceUrl, quoteOrFact} aligned only with reporting referenced in the article.",
    citationGuide,
    entityGuide,
    "entities must be {name, definition} entries aligned with your bracketed terms.",
    "dataBlocks must reflect statistics cited in the Data Insight section. When the source packets contain at least 2 comparable numeric facts, you MUST create a dataBlock with a chart. Only set dataBlocks to [] when there are truly no usable numeric facts across all sources.",
    "Include tldr with keys whyItMatters, whoIsAffected, whatIsNext.",
    ...buildPreviousCoverageSection(previousCoverage),
    "WARNING: The source packets below may include entries about UNRELATED companies or events. Only use packets that directly relate to the headline topic. If a packet is about a completely different company, person, or event, IGNORE it and do not reference it in the story. One article = one topic.",
    `Source packets (sanitized JSON): ${JSON.stringify(sanitizeSourcesForPrompt(sources, compact))}`,
  ].join("\n");
}

function buildPreviousCoverageSection(previous?: PreviousCoverage[]): string[] {
  if (!previous || previous.length === 0) return [];

  const lines: string[] = [
    "",
    "--- PREVIOUS COVERAGE CONTEXT ---",
    "We recently published these related stories. Reference them naturally where relevant:",
  ];

  for (const cov of previous) {
    const date = cov.publishedAt.toISOString().slice(0, 10);
    lines.push(`- [${date}] ${cov.headline}`);
    if (cov.keyFacts.length > 0) {
      lines.push(`  Key facts: ${cov.keyFacts.slice(0, 3).join(" | ")}`);
    }
  }

  lines.push(
    "If this new article continues a story we've covered, open with a brief nod to our previous reporting.",
    "Do NOT repeat entire paragraphs from prior coverage — assume readers have seen it and want an update.",
    "--- END PREVIOUS COVERAGE ---",
    "",
  );

  return lines;
}

function normalizePost(topic: TrendCandidate, parsed: any): GeneratedPost {
  const parsedDesk = typeof parsed.editorialCategory === "string" ? parsed.editorialCategory.trim() : "";
  const allowedDesks: EditorialCategory[] = ["Tech", "Funding", "Civics", "Culture", "Transit", "Food", "Events", "GitHub Top"];
  const editorialCategory = allowedDesks.includes(parsedDesk as EditorialCategory)
    ? (parsedDesk as EditorialCategory)
    : (topic.editorialCategory ?? classifyEditorialCategory(topic));

  return {
    headline: parsed.headline,
    slug: parsed.slug,
    dek: parsed.dek,
    bodyMarkdown: parsed.bodyMarkdown,
    shortPost: parsed.shortPost,
    topic: topic.topic,
    editorialCategory,
    credits: Array.isArray(parsed.credits) ? parsed.credits : [],
    citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    tldr: parsed.tldr,
    entities: parsed.entities,
    dataBlocks: parsed.dataBlocks,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** True when the story prose clearly references this outlet (name, linked domain, or parenthetical tag). */
export function sourceReferencedInBody(bodyRaw: string, sourceName: string, articleUrl: string): boolean {
  const body = bodyRaw.toLowerCase();
  const name = sourceName.trim().toLowerCase();
  if (name.length >= 3 && body.includes(name)) return true;
  const host = hostnameFromUrl(articleUrl);
  if (host && body.includes(host)) return true;
  const short = sourceName.replace(/^The\s+/i, "").trim();
  if (short.length >= 3 && new RegExp(`\\(${escapeRegExp(short)}\\)`, "i").test(bodyRaw)) return true;

  // Wire-style shorthand seen in prose
  if (/^ap news$/i.test(sourceName.trim()) && /(\(ap\)|\bassociated press\b|\bap news\b)/i.test(bodyRaw)) return true;
  if (/^bbc$/i.test(sourceName.trim()) && /(\(bbc\)|\bbbc news\b|\bbbc\b)/i.test(bodyRaw)) return true;

  return false;
}

function isUsableDataBlock(block: unknown): block is NonNullable<GeneratedPost["dataBlocks"]>[number] {
  if (!block || typeof block !== "object") return false;
  const b = block as Record<string, unknown>;
  const type = b.type;
  const title = b.title;
  const data = b.data;
  const xl = b.xAxisLabel;
  const yl = b.yAxisLabel;
  if (typeof type !== "string" || typeof title !== "string") return false;
  if (!["bar", "histogram", "scatter", "line"].includes(type)) return false;
  if (typeof xl !== "string" || typeof yl !== "string") return false;
  if (!Array.isArray(data) || data.length < 2) return false;
  for (const row of data) {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    if (type === "bar" || type === "histogram") {
      if (typeof r.label !== "string" || typeof r.value !== "number" || Number.isNaN(r.value)) return false;
    } else {
      if (typeof r.x !== "number" || typeof r.y !== "number" || Number.isNaN(r.x) || Number.isNaN(r.y)) return false;
    }
  }
  return true;
}

function syncChartPlaceholders(
  body: string,
  originalBlocks: GeneratedPost["dataBlocks"],
): { body: string; blocks: GeneratedPost["dataBlocks"] } {
  const orig = Array.isArray(originalBlocks) ? originalBlocks : [];
  const usablePairs: { block: NonNullable<GeneratedPost["dataBlocks"]>[number]; oldIdx: number }[] = [];
  orig.forEach((b, oldIdx) => {
    if (isUsableDataBlock(b)) usablePairs.push({ block: b, oldIdx });
  });
  const newBlocks = usablePairs.map((p) => p.block);
  const oldToNew = new Map<number, number>();
  usablePairs.forEach((p, newIdx) => oldToNew.set(p.oldIdx, newIdx));

  let out = body.replace(/\[CHART:(\d+)\]/g, (_, raw) => {
    const oldIdx = Number.parseInt(raw, 10);
    const nu = oldToNew.get(oldIdx);
    return nu !== undefined ? `[CHART:${nu}]` : "";
  });

  if (newBlocks.length === 0) {
    out = out.replace(/\[CHART:\d+\]/g, "");
  }

  return { body: out.trim(), blocks: newBlocks };
}

function pruneReceiptsToBody(post: GeneratedPost): GeneratedPost {
  const body = post.bodyMarkdown || "";
  let citations = (post.citations ?? []).filter((c) => sourceReferencedInBody(body, c.sourceName, c.sourceUrl));
  citations = citations.slice(0, 8);

  const citeKey = (name: string, url: string) => `${name.trim().toLowerCase()}|${normalizeUrl(url)}`;
  const citationKeys = new Set(citations.map((c) => citeKey(c.sourceName, c.sourceUrl)));

  let credits = (post.credits ?? []).filter(
    (c) =>
      sourceReferencedInBody(body, c.sourceName, c.articleUrl) ||
      citationKeys.has(citeKey(c.sourceName, c.articleUrl)),
  );

  const seenCreditUrl = new Set<string>();
  credits = credits.filter((c) => {
    const k = normalizeUrl(c.articleUrl);
    if (seenCreditUrl.has(k)) return false;
    seenCreditUrl.add(k);
    return true;
  });

  return { ...post, citations, credits };
}

/** Remove orphan charts and receipts for outlets not referenced in the narrative. */
export function finalizePostForPublish(post: GeneratedPost): GeneratedPost {
  const synced = syncChartPlaceholders(post.bodyMarkdown ?? "", post.dataBlocks);
  return pruneReceiptsToBody({
    ...post,
    bodyMarkdown: synced.body,
    dataBlocks: synced.blocks,
  });
}

export function buildEventsDigestPost(events: EventInfo[]): GeneratedPost {
  const dayStamp = new Date().toISOString().slice(0, 10);
  const headline = `Bay Area builder & VC events — ${dayStamp}`;
  const slug = `events-digest-${dayStamp}-${crypto.randomUUID().slice(0, 8)}`;
  const bodyMarkdown = [
    "### The lineup",
    "",
    ...events.flatMap((e) => [
      `#### ${e.title}`,
      `- **When:** ${e.date}`,
      `- **RSVP (${e.source}):** ${e.url}`,
      "",
    ]),
    "### Source notes",
    "Links open the public RSVP pages we parsed from Luma / organizer listings (see receipts).",
  ].join("\n");

  return {
    headline,
    slug,
    dek: "Curated SF / peninsula happenings weighted toward founders, investors, and AI builders.",
    bodyMarkdown,
    shortPost: `${events.length} upcoming Bay Area events for founders and investors — full RSVP links inside.`,
    topic: headline,
    editorialCategory: "Events",
    credits: events.map((e) => ({
      sourceName: "Public Data",
      articleUrl: e.url,
      factBullets: [`${e.title} (${e.date})`],
      sourceType: "data_source",
      confidence: "high" as const,
    })),
    citations: events.slice(0, 8).map((e) => ({
      claim: `${e.title} is listed for ${e.date}.`,
      sourceName: "Public Data",
      sourceUrl: e.url,
      quoteOrFact: `RSVP via ${e.source}`,
    })),
    tldr: {
      whyItMatters: "These gatherings concentrate founders, capital, and hiring momentum.",
      whoIsAffected: "Operators raising rounds, engineers switching roles, and investors sourcing pipeline.",
      whatIsNext: "RSVP early; capacity constraints are common on popular nights.",
    },
    entities: [],
    dataBlocks: [],
  };
}

async function synthesizeWithGemini(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  mode: PromptMode,
  previousCoverage?: PreviousCoverage[],
) {
  if (!geminiAi) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const response = await geminiAi.models.generateContent({
    model: config.geminiModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildPrompt(topic, sources, mode, previousCoverage),
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: { type: Type.STRING },
          slug: { type: Type.STRING },
          dek: { type: Type.STRING },
          bodyMarkdown: { type: Type.STRING },
          shortPost: { type: Type.STRING },
          credits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sourceName: { type: Type.STRING },
                articleUrl: { type: Type.STRING },
                sourceType: { type: Type.STRING },
                publishedAt: { type: Type.STRING },
                confidence: { type: Type.STRING },
                factBullets: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["sourceName", "articleUrl", "sourceType", "confidence", "factBullets"],
            },
          },
          citations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                claim: { type: Type.STRING },
                sourceName: { type: Type.STRING },
                sourceUrl: { type: Type.STRING },
                quoteOrFact: { type: Type.STRING },
              },
              required: ["claim", "sourceName", "sourceUrl", "quoteOrFact"],
            },
          },
          tldr: {
            type: Type.OBJECT,
            properties: {
              whyItMatters: { type: Type.STRING },
              whoIsAffected: { type: Type.STRING },
              whatIsNext: { type: Type.STRING },
            },
            required: ["whyItMatters", "whoIsAffected", "whatIsNext"],
          },
          entities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                definition: { type: Type.STRING },
              },
              required: ["name", "definition"],
            },
          },
          dataBlocks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                title: { type: Type.STRING },
                xAxisLabel: { type: Type.STRING },
                yAxisLabel: { type: Type.STRING },
                data: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      value: { type: Type.NUMBER },
                      x: { type: Type.NUMBER },
                      y: { type: Type.NUMBER },
                    },
                  },
                },
              },
              required: ["type", "title", "xAxisLabel", "yAxisLabel", "data"],
            },
          },
          editorialCategory: { type: Type.STRING },
        },
        required: ["headline", "slug", "dek", "bodyMarkdown", "shortPost", "credits", "citations", "tldr", "entities", "dataBlocks", "editorialCategory"],
      },
    },
  });

  const parsed = parseModelJson(response.text ?? "{}", "Gemini synthesis JSON") as Record<string, unknown>;
  return normalizePost(topic, parsed);
}

async function synthesizeWithFireworks(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  mode: PromptMode,
  previousCoverage?: PreviousCoverage[],
) {
  if (!config.fireworksApiKey) {
    throw new Error("FIREWORKS_API_KEY is not configured.");
  }

  const response = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.fireworksApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.fireworksModel,
      messages: [
        {
          role: "system",
          content:
            "You are a grounded newsroom writer. Return only valid JSON including editorialCategory (one of: Tech, Funding, Civics, Culture, Transit, Food, Events, GitHub Top). Never truncate JSON.",
        },
        {
          role: "user",
          content: buildPrompt(topic, sources, mode, previousCoverage),
        },
      ],
      temperature: mode === "compact" ? 0.12 : 0.2,
      response_format: {
        type: "json_object",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fireworks request failed with ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Fireworks response did not include message content.");
  }

  const parsed = parseModelJson(content, "Fireworks synthesis JSON") as Record<string, unknown>;
  return normalizePost(topic, parsed);
}

/**
 * Extract entities from an article body using a focused, cheap LLM call.
 * Returns entities array or empty array on failure.
 */
async function extractEntitiesFromBody(bodyMarkdown: string): Promise<GeneratedPost["entities"]> {
  if (!config.fireworksApiKey) return [];

  const prompt = [
    "Extract notable entities (companies, people, products, organizations, acronyms, technical terms, named locations) from the article below.",
    "Return a JSON array of {name, definition} objects.",
    "Each definition must be a short plain-English sentence explaining what the entity IS in context of this article.",
    "Include at least 8 entities. Do not include generic words like 'company', 'industry', 'data'.",
    "",
    "Article:",
    bodyMarkdown.slice(0, 6000),
  ].join("\n");

  try {
    const response = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.fireworksApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.fireworksModel,
        messages: [
          { role: "system", content: "Return only a valid JSON array of {name, definition} objects. Minimum 8 entries." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.warn("Entity extraction LLM call failed:", response.status);
      return [];
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = parseModelJson(content, "Entity extraction") as Record<string, unknown>;
    const raw = parsed.entities ?? parsed;
    if (Array.isArray(raw)) {
      const valid = raw.filter(
        (e: unknown): e is { name: string; definition: string } =>
          typeof e === "object" && e !== null && typeof (e as any).name === "string" && typeof (e as any).definition === "string",
      );
      return valid.length >= 3 ? valid : [];
    }
    return [];
  } catch (err) {
    console.warn("Entity extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Extract chart-worthy numeric data from an article body and source packets.
 * Returns dataBlocks array or empty array on failure.
 */
async function extractChartsFromBody(
  bodyMarkdown: string,
  sources: SourceExtraction[],
): Promise<GeneratedPost["dataBlocks"]> {
  if (!config.fireworksApiKey) return [];

  const sourceNumbers = sources
    .flatMap((s) => s.facts ?? [])
    .filter((f) => /\d/.test(f))
    .slice(0, 10);

  // Also extract number-containing lines from the Data Insight section of the body
  const insightSection = bodyMarkdown.match(/### The Data Insight[\s\S]*?(?=###|$)/)?.[0] ?? "";
  const bodyNumbers = insightSection
    .split("\n")
    .filter((line) => /\d/.test(line) && line.trim().length > 10)
    .slice(0, 8);

  if (sourceNumbers.length < 2 && bodyNumbers.length < 2) return [];

  const numericContext = [
    sourceNumbers.length > 0 ? "Numeric facts from source material:" : "",
    ...sourceNumbers.map((f, i) => `${i + 1}. ${f}`),
    "",
    bodyNumbers.length > 0 ? "Number-containing lines from the Data Insight section:" : "",
    ...bodyNumbers.map((l, i) => `${i + 1}. ${l}`),
  ].filter(Boolean).join("\n");

  const prompt = [
    "The article below has a Data Insight section. The following numeric data was extracted:",
    numericContext,
    "",
    "If at least 2 of these facts can be meaningfully compared or plotted together, return a JSON object with a single key 'dataBlocks' containing an array of chart objects.",
    "Each chart: {type: 'bar'|'line'|'histogram'|'scatter', title, xAxisLabel, yAxisLabel, data: [{label, value}]}",
    "If no meaningful chart is possible, return {dataBlocks: []}.",
    "",
    "Article body:",
    bodyMarkdown.slice(0, 5000),
  ].join("\n");

  try {
    const response = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.fireworksApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.fireworksModel,
        messages: [
          { role: "system", content: "Return only valid JSON with a dataBlocks array." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      console.warn("Chart extraction LLM call failed:", response.status);
      return [];
    }

    const data = (await response.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = parseModelJson(content, "Chart extraction") as Record<string, unknown>;
    const raw = parsed.dataBlocks ?? parsed;
    if (Array.isArray(raw)) {
      return raw.filter((b: unknown) => isUsableDataBlock(b)) as GeneratedPost["dataBlocks"];
    }
    return [];
  } catch (err) {
    console.warn("Chart extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Automatically extract important proper nouns and capitalized terms from body text
 * that aren't already in the entities list. Generates simple contextual definitions.
 */
function extractProperNounsAuto(body: string, existingNames: Set<string>): GeneratedPost["entities"] {
  // Skip these common capitalized words (sentence starts, months, days, common terms)
  const SKIP_WORDS = new Set([
    "the", "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "we", "our", "you", "your", "he", "she", "his", "her", "him",
    "but", "and", "for", "nor", "yet", "so", "are", "was", "were", "been",
    "not", "all", "any", "each", "every", "both", "few", "more", "most", "much",
    "some", "such", "than", "then", "now", "here", "there", "when", "where",
    "why", "how", "what", "who", "whom", "which", "while", "after", "before",
    "between", "through", "during", "without", "within", "along", "among",
    "about", "above", "across", "against", "around", "behind", "below", "beneath",
    "beside", "beyond", "down", "inside", "into", "near", "off", "onto",
    "outside", "over", "under", "up", "upon", "with", "just", "also", "very",
    "too", "already", "still", "yet", "again", "ever", "never", "quite", "rather",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december", "today", "yesterday", "tomorrow",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "american", "british", "european", "asian", "african", "global", "international",
    "ceo", "cto", "cfo", "chief", "president", "chairman", "director", "manager",
    "however", "therefore", "meanwhile", "furthermore", "nevertheless", "nonetheless",
    "according", "including", "regarding", "despite", "although", "because",
  ]);

  const MIN_WORD_LENGTH = 3;
  const MAX_WORD_LENGTH = 50;

  const found = new Map<string, number>(); // name -> count
  const textLower = body.toLowerCase();

  // 1. Find multi-word capitalized phrases (e.g. "Sam Altman", "Series D")
  const multiWordRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z0-9]+)+)/g;
  let m: RegExpExecArray | null;
  while ((m = multiWordRegex.exec(body)) !== null) {
    const phrase = m[1].trim();
    if (phrase.length < MIN_WORD_LENGTH || phrase.length > MAX_WORD_LENGTH) continue;
    if (existingNames.has(phrase.toLowerCase())) continue;
    if (SKIP_WORDS.has(phrase.toLowerCase())) continue;
    // Skip if any word in the phrase is a skip word (unless it's a short connector like "and")
    const words = phrase.split(/\s+/);
    const significantWords = words.filter(w => w.length > 2 && !SKIP_WORDS.has(w.toLowerCase()));
    if (significantWords.length < 1) continue;
    found.set(phrase, (found.get(phrase) ?? 0) + 1);
  }

  // 2. Find single capitalized words that are NOT at the start of a sentence
  const singleWordRegex = /[.?!]\s+([A-Z][a-z0-9]{2,})/g;
  while ((m = singleWordRegex.exec(body)) !== null) {
    const word = m[1].trim();
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
    const lower = word.toLowerCase();
    if (existingNames.has(lower)) continue;
    if (SKIP_WORDS.has(lower)) continue;
    // Also skip if it's preceded by common title words that suggest it's a sentence start in a heading
    // Filter out common English words that happen to be capitalized mid-sentence
    if (/^\d/.test(word)) continue;
    found.set(word, (found.get(word) ?? 0) + 1);
  }

  // 3. Also find capitalized words mid-sentence (after comma, semicolon, dash, or parenthesis)
  const midSentenceRegex = /[,;:({\[]\s+([A-Z][a-z0-9]{2,})/g;
  while ((m = midSentenceRegex.exec(body)) !== null) {
    const word = m[1].trim();
    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
    const lower = word.toLowerCase();
    if (existingNames.has(lower)) continue;
    if (SKIP_WORDS.has(lower)) continue;
    if (/^\d/.test(word)) continue;
    found.set(word, (found.get(word) ?? 0) + 1);
  }

  // Filter: only keep terms that appear at least twice (more likely to be significant)
  // But keep single mentions for longer/more specific terms (>7 chars)
  const results: GeneratedPost["entities"] = [];
  for (const [name, count] of found) {
    if (count < 2 && name.length <= 7) continue;
    if (results.length >= 30) break;

    const lower = name.toLowerCase();

    // Generate a definition based on context
    let definition = generateAutoDefinition(name, body);

    // Skip if definition is too generic
    if (!definition || definition.length < 5) continue;

    existingNames.add(lower);
    results.push({ name, definition });
  }

  // Sort by length descending (longer names first so they get matched before shorter substrings)
  results.sort((a, b) => b.name.length - a.name.length);
  return results;
}

/** Generate a simple contextual definition for an auto-detected proper noun. */
function generateAutoDefinition(name: string, body: string): string {
  const lower = name.toLowerCase();

  // Common patterns for definitions
  if (lower.endsWith(" inc") || lower.endsWith(" corp") || lower.endsWith(" ltd")) {
    return `${name} is a company referenced in this article.`;
  }
  if (lower.includes(" fund") || lower.includes(" ventures") || lower.includes(" capital")) {
    return `${name} is an investment firm or venture capital fund.`;
  }
  if (lower.includes(" round") || lower.includes(" series ")) {
    return `${name} is a funding round stage.`;
  }
  if (lower.includes(" university") || lower.includes(" college") || lower.includes(" institute")) {
    return `${name} is an academic or research institution.`;
  }
  if (lower.includes(" report") || lower.includes(" survey")) {
    return `${name} is a research report or publication.`;
  }
  if (lower.includes(" act") || lower.includes(" bill") || lower.includes(" regulation")) {
    return `${name} is a legislative act, bill, or regulation.`;
  }

  // Try to find context in the body text around the first occurrence
  const idx = body.toLowerCase().indexOf(lower);
  if (idx >= 0) {
    const start = Math.max(0, idx - 80);
    const end = Math.min(body.length, idx + name.length + 80);
    const snippet = body.slice(start, end);

    // Try to extract a descriptive clause
    const descMatch = snippet.match(new RegExp(
      `${escapeRegExp(name)}\\s+[,(]\\s*([^,.;)]{10,80})`,
      "i",
    ));
    if (descMatch) {
      const desc = descMatch[1].trim();
      if (desc.length > 10 && desc.length < 100) {
        return desc;
      }
    }

    // Try "is a" / "is an" pattern
    const isMatch = snippet.match(new RegExp(
      `${escapeRegExp(name)}\\s+is\\s+(?:a|an)\\s+([^,.;]{5,60})`,
      "i",
    ));
    if (isMatch) {
      return `${name} is a ${isMatch[1].trim()}.`;
    }
  }

  // Generic fallback based on capitalization patterns
  if (name === name.toUpperCase() && name.length <= 8) {
    return `${name} is an acronym or abbreviation in the context of this article.`;
  }
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name)) {
    return `${name} is a named entity (person, organization, or term) in this article.`;
  }

  return "";
}

/**
 * Merges manually-defined entities with auto-extracted ones and brackets all of them in the body.
 * Also ensures definitions exist for all bracketed terms.
 */
function enrichEntities(
  body: string,
  entities: GeneratedPost["entities"],
): { body: string; entities: GeneratedPost["entities"] } {
  const existingNames = new Set((entities ?? []).map((e) => (e.name ?? "").toLowerCase().trim()).filter(Boolean));

  // Auto-extract additional proper nouns from the body
  const autoEntities = extractProperNounsAuto(body, existingNames);

  if (autoEntities.length === 0) {
    // Still bracket existing entities in the body
    return { body: insertEntityBrackets(body, entities ?? []), entities: entities ?? [] };
  }

  const merged = [...(entities ?? []), ...autoEntities];

  // Now bracket ALL entities (existing + auto) in the body
  const bracketedBody = insertEntityBrackets(body, merged);

  return { body: bracketedBody, entities: merged };
}

/**
 * Insert [[Bracketed Terms]] around entity names in body text for explicit entity highlighting.
 * Only wraps occurrences that are not already bracketed and are on word boundaries.
 * Sorts entities longest-first to avoid partial overlaps (e.g., "OpenAI" vs "OpenAI LP").
 */
function insertEntityBrackets(body: string, entities: GeneratedPost["entities"]): string {
  const sorted = [...(entities ?? [])]
    .filter((e) => e?.name?.trim().length >= 3)
    .sort((a, b) => b.name.length - a.name.length);

  if (sorted.length === 0) return body;

  // Build a pattern that matches any entity name, but skip positions inside [[...]]
  const alreadyBracketed = /\[\[([^\]]+)\]\]/g;
  const bracketedRanges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = alreadyBracketed.exec(body)) !== null) {
    bracketedRanges.push([m.index, m.index + m[0].length]);
  }

  const isInsideBrackets = (pos: number) =>
    bracketedRanges.some(([start, end]) => pos >= start && pos < end);

  const isWordBoundary = (text: string, pos: number) => {
    const before = pos > 0 ? text[pos - 1] : " ";
    const after = pos < text.length ? text[pos] : " ";
    const alphaNum = /[A-Za-z0-9_]/;
    return !alphaNum.test(before) && !alphaNum.test(after);
  };

  // Replace each entity occurrence, working from longest to shortest,
  // and track already-replaced ranges to avoid double-wrapping.
  const replacedRanges: Array<[number, number]> = [];
  const isAlreadyReplaced = (pos: number, end: number) =>
    replacedRanges.some(([rs, re]) => pos < re && end > rs);

  let result = body;
  for (const entity of sorted) {
    const needle = entity.name.trim();
    if (!needle) continue;

    const needleLower = needle.toLowerCase();
    const resultLower = result.toLowerCase();
    let idx = 0;

    while (idx < result.length) {
      const found = resultLower.indexOf(needleLower, idx);
      if (found < 0) break;

      const end = found + needle.length;

      // Skip if inside existing [[...]], or already replaced by a longer entity
      if (!isInsideBrackets(found) && !isAlreadyReplaced(found, end) && isWordBoundary(result, found) && isWordBoundary(result, end)) {
        const before = result.slice(0, found);
        const after = result.slice(end);
        result = `${before}[[${result.slice(found, end)}]]${after}`;
        replacedRanges.push([found, end + needle.length + 4]); // account for added [[ ]]
        idx = end + 4; // skip past the inserted brackets
      } else {
        idx = end;
      }
    }
  }

  return result;
}

export async function synthesizePost(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  previousCoverage?: PreviousCoverage[],
): Promise<GeneratedPost> {
  const modes: PromptMode[] = ["full", "compact"];
  let lastErr: unknown;
  for (const mode of modes) {
    try {
      let post: GeneratedPost;
      if (config.llmProvider === "fireworks") {
        post = await synthesizeWithFireworks(topic, sources, mode, previousCoverage);
      } else {
        post = await synthesizeWithGemini(topic, sources, mode, previousCoverage);
      }

      const entityCount = (post.entities ?? []).length;
      const chartCount = (post.dataBlocks ?? []).length;

      // If entities are too few, do a focused entity extraction pass
      if (entityCount < 3) {
        console.log(`[synthesizePost] Entities low (${entityCount}), attempting entity enrichment...`);
        const extraEntities = await extractEntitiesFromBody(post.bodyMarkdown ?? "");
        if (extraEntities.length > 0) {
          // Merge: keep existing entities, add new ones that don't overlap
          const existingNames = new Set((post.entities ?? []).map((e) => (e.name ?? "").toLowerCase()));
          const merged = [...(post.entities ?? [])];
          for (const e of extraEntities) {
            if (e.name && !existingNames.has(e.name.toLowerCase())) {
              merged.push(e);
              existingNames.add(e.name.toLowerCase());
            }
          }
          post = { ...post, entities: merged };
          console.log(`[synthesizePost] Entities enriched: ${entityCount} → ${merged.length}`);
        }
      }

      // Auto-enrich entities: extract proper nouns from body, generate definitions, bracket them
      if (post.bodyMarkdown) {
        const enriched = enrichEntities(post.bodyMarkdown, post.entities ?? []);
        if (enriched.entities.length !== (post.entities ?? []).length) {
          const added = enriched.entities.length - (post.entities ?? []).length;
          console.log(`[synthesizePost] Auto-extracted ${added} additional entities from body; ${enriched.entities.length} total bracketed terms`);
        }
        post = { ...post, bodyMarkdown: enriched.body, entities: enriched.entities };
      }

      // If charts are missing but we have a Data Insight section, attempt extraction
      if (chartCount === 0 && (post.bodyMarkdown ?? "").includes("### The Data Insight")) {
        console.log(`[synthesizePost] No charts but Data Insight section exists, attempting chart enrichment...`);
        const extraCharts = await extractChartsFromBody(post.bodyMarkdown ?? "", sources);
        if (extraCharts.length > 0) {
          post = { ...post, dataBlocks: extraCharts };
          console.log(`[synthesizePost] Charts enriched: 0 → ${extraCharts.length}`);
        }
      }

      return finalizePostForPublish(post);
    } catch (err) {
      lastErr = err;
      console.warn(`synthesizePost (${mode}) failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function rewritePostForCopyrightSafety(post: GeneratedPost, reason: string): Promise<GeneratedPost> {
  const prompt = `
    You are the Times of SF senior editor doing a copyright-safety rewrite.
    The article below was rejected by an automated overlap checker:
    ${reason}

    Rewrite the article body from scratch while preserving the same facts, analytical meaning, markdown headings, [[Entity]] brackets, and any [CHART:N] tokens.
    Use different sentence structures, different clause order, and different vocabulary throughout.
    Do not add new facts. Do not remove the Source Notes section.
    Avoid reusing any 5+ word sequence from the current article.

    Return ONLY valid JSON:
    {
      "dek": "rewritten dek",
      "shortPost": "rewritten short social summary",
      "bodyMarkdown": "rewritten markdown body"
    }

    Current dek:
    ${post.dek}

    Current shortPost:
    ${post.shortPost}

    Current bodyMarkdown:
    ${post.bodyMarkdown}
  `;

  let raw = "";
  if (config.llmProvider === "fireworks") {
    if (!config.fireworksApiKey) throw new Error("FIREWORKS_API_KEY is not configured.");
    const response = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.fireworksApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.fireworksModel,
        messages: [
          {
            role: "system",
            content:
              "You are a careful rewrite editor. Return only valid JSON. Preserve facts, but substantially rewrite the prose.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.35,
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Fireworks rewrite failed with ${response.status}: ${errorText}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    raw = data.choices?.[0]?.message?.content ?? "";
  } else {
    if (!geminiAi) throw new Error("GEMINI_API_KEY not configured.");
    const result = await geminiAi.models.generateContent({
      model: config.geminiModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });
    raw = result.text ?? "";
  }

  if (!raw.trim()) throw new Error("Rewrite response was empty.");
  const parsed = parseModelJson(raw, "Copyright rewrite JSON") as Record<string, unknown>;
  const bodyMarkdown = typeof parsed.bodyMarkdown === "string" && parsed.bodyMarkdown.trim()
    ? parsed.bodyMarkdown.trim()
    : post.bodyMarkdown;
  const dek = typeof parsed.dek === "string" && parsed.dek.trim() ? parsed.dek.trim() : post.dek;
  const shortPost = typeof parsed.shortPost === "string" && parsed.shortPost.trim()
    ? parsed.shortPost.trim()
    : post.shortPost;

  return finalizePostForPublish({ ...post, dek, shortPost, bodyMarkdown });
}

export async function expandContent(
  headline: string, 
  currentContent: string, 
  entities: GeneratedPost['entities'] = [],
  dataBlocks: GeneratedPost['dataBlocks'] = []
): Promise<string> {
  const entityContext = entities.length > 0 
    ? `\nAvailable Entities (use [[Name]] to highlight):\n${entities.map(e => `- ${e.name}`).join("\n")}`
    : "";
  
  const chartContext = dataBlocks.length > 0
    ? `\nAvailable Charts (use [CHART:index] to insert):\n${dataBlocks.map((b, i) => `- [CHART:${i}]: ${b.title}`).join("\n")}`
    : "";

  const prompt = `
    You are the Times of SF senior editor.
    Expand the markdown below into a full feature-length report (approx 1,200-1,700 words).
    Do not change the underlying facts, but add analytical depth and long-term implications.
    Maintain the grounded editorial tone.

    CRITICAL: Do NOT invent neighborhood-specific SF detail unless it appears in the text below.
    Copyright safety: do not mimic source wording or distinctive phrasing.

    Structure: preserve existing ### headers when present; otherwise use exactly:
    ### The Dispatch: The Immediate News and Its Primary Impact
    ### The Context: Historical Background and Broader Industry Trends
    ### The Data Insight: A Rigorous Analysis of the Underlying Numbers
    ### The Horizon: Long-Term Implications and the Future Outlook
    ### Source Notes

    IMPORTANT:
    1. Use [[Bracketed Terms]] for companies, people, and technical concepts—aim for at least 10 where supported.
    1a. Prioritize adding [[Bracketed Terms]] for reader-confusing concepts (acronyms, key mechanisms, bottlenecks, jargon), and keep each definition short and plain-English.
    2. Insert [CHART:index] ONLY when charts are listed below and the surrounding prose analyzes those exact figures—never add chart placeholders without real plotted data.
    3. Return ONLY markdown body content—no JSON, no outer headline.

    ${entityContext}
    ${chartContext}

    Current article body:
    ${currentContent}

    Expand this story:
  `;

  if (config.llmProvider === "fireworks") {
    const response = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.fireworksApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.fireworksModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) {
      console.error("Fireworks expansion failed:", data);
      throw new Error(`Fireworks error: ${JSON.stringify(data)}`);
    }
    if (!data.choices?.[0]?.message?.content) {
      console.error("Unexpected Fireworks response:", data);
      throw new Error("No content in Fireworks response");
    }
    return data.choices[0].message.content;
  }

  if (!geminiAi) throw new Error("GEMINI_API_KEY not configured.");
  const result = await geminiAi.models.generateContent({
    model: config.geminiModel,
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  });
  return result.text || "";
}
