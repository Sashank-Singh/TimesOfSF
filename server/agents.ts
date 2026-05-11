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

function buildPrompt(topic: TrendCandidate, sources: SourceExtraction[], mode: PromptMode): string {
  const desk: EditorialCategory = topic.editorialCategory ?? classifyEditorialCategory(topic);
  const deskNotes =
    desk === "Food"
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
    ? "Use [[Bracketed Terms]] for 8–12 entities drawn verbatim from sources; entities array must define each bracketed term."
    : "Use [[Bracketed Terms]] for 12–18 entities drawn from sources; entities array must define each bracketed term.";
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
    "Avoid flowery filler, clickbait, fake certainty, and hype phrases like 'shocking' or 'you won't believe'.",
    "Do not say the story is based on '200+ sources'; cite only the sources actually provided.",
    "Copyright safety: extract facts, not prose. Do not mimic source wording, sentence cadence, headline structure, or distinctive framing.",
    "Every factual claim must map to a source credit. Use inline citations like (Reuters) after specific factual claims.",
    "Separate confirmed facts from analysis. Label uncertainty plainly.",
    "Prefer primary documents, official statements, filings, and public data when present in the source packets.",
    "Structure bodyMarkdown using ### headers in this EXACT order:",
    "### The Dispatch: The Immediate News and Its Primary Impact",
    "### The Context: Historical Background and Broader Industry Trends",
    "### The Data Insight: A Rigorous Analysis of the Underlying Numbers",
    "### The Horizon: Long-Term Implications and the Future Outlook",
    "### Source Notes",
    "The Dispatch leads with what happened and why readers should care now. The Context widens to history and industry dynamics. The Data Insight focuses on quantitative interpretation—ONLY when the sources supply at least TWO comparable numeric facts worth plotting. If there is nothing meaningful to chart, write analytic prose only: set dataBlocks to [] and do NOT insert any [CHART:N] tokens anywhere. When you do chart, insert [CHART:0] exactly once inside The Data Insight and ensure dataBlocks[0] matches those numbers.",
    "Use rich paragraphs; bullet lists only where density demands it.",
    "Entity definitions must be plain-English, jargon-free, and written for non-experts; for each entity, add a short sentence explaining how the term functions in this article (not just a dictionary definition).",
    "When charts are warranted: use bar, histogram, scatter, or line. Line for time series; scatter for disconnected points.",
    "Each dataBlock needs type, title, xAxisLabel, yAxisLabel, and data.",
    "For bar/histogram use {label, value}. For scatter/line use numeric {x, y, label}.",
    "Chart axes must name real dimensions (e.g. Quarter and Revenue ($M)); never use Category/Value placeholders.",
    "credits must ONLY list outlets you actually cite or link to inside bodyMarkdown. Omit every unused RSS packet.",
    "OUTPUT RULES: Reply with ONE JSON object only. Escape double-quotes inside strings as \\\" and use \\n for newlines—never output raw multi-line strings inside JSON.",
    `Return JSON keys: headline, slug, dek, bodyMarkdown, shortPost, credits, citations, entities, dataBlocks, editorialCategory, tldr.`,
    `editorialCategory must be one of: Tech, Funding, Civics, Culture, Transit, Food, Events — prefer "${desk}" unless sources clearly belong elsewhere.`,
    "credits: include sourceName, articleUrl, sourceType, publishedAt when known, confidence, factBullets — one row per outlet you truly used.",
    "citations must be an array of {claim, sourceName, sourceUrl, quoteOrFact} aligned only with reporting referenced in the article.",
    citationGuide,
    entityGuide,
    "entities must be {name, definition} entries aligned with your bracketed terms.",
    "dataBlocks must reflect statistics cited in the Data Insight section (or be an empty array if none).",
    "Include tldr with keys whyItMatters, whoIsAffected, whatIsNext.",
    `Source packets (sanitized JSON): ${JSON.stringify(sanitizeSourcesForPrompt(sources, compact))}`,
  ].join("\n");
}

function normalizePost(topic: TrendCandidate, parsed: any): GeneratedPost {
  const parsedDesk = typeof parsed.editorialCategory === "string" ? parsed.editorialCategory.trim() : "";
  const allowedDesks: EditorialCategory[] = ["Tech", "Funding", "Civics", "Culture", "Transit", "Food", "Events"];
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

async function synthesizeWithGemini(topic: TrendCandidate, sources: SourceExtraction[], mode: PromptMode) {
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
            text: buildPrompt(topic, sources, mode),
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

async function synthesizeWithFireworks(topic: TrendCandidate, sources: SourceExtraction[], mode: PromptMode) {
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
            "You are a grounded newsroom writer. Return only valid JSON including editorialCategory (one of: Tech, Funding, Civics, Culture, Transit, Food, Events). Never truncate JSON.",
        },
        {
          role: "user",
          content: buildPrompt(topic, sources, mode),
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

export async function synthesizePost(topic: TrendCandidate, sources: SourceExtraction[]): Promise<GeneratedPost> {
  const modes: PromptMode[] = ["full", "compact"];
  let lastErr: unknown;
  for (const mode of modes) {
    try {
      if (config.llmProvider === "fireworks") {
        return finalizePostForPublish(await synthesizeWithFireworks(topic, sources, mode));
      }
      return finalizePostForPublish(await synthesizeWithGemini(topic, sources, mode));
    } catch (err) {
      lastErr = err;
      console.warn(`synthesizePost (${mode}) failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
