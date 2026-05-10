import crypto from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { jsonrepair } from "jsonrepair";
import { config } from "./config";
import { classifyEditorialCategory } from "./editorial";
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
function sanitizeSourcesForPrompt(sources: SourceExtraction[]): SourceExtraction[] {
  return sources.map((s) => ({
    ...s,
    headline: clampPromptText(s.headline, 400),
    summary: clampPromptText(s.summary, 1200),
    textExcerpt: clampPromptText(s.textExcerpt, 3200),
    facts: (s.facts ?? []).slice(0, 8).map((f) => clampPromptText(f, 550)),
  }));
}

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

function buildPrompt(topic: TrendCandidate, sources: SourceExtraction[]) {
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

  return [
    "You are the Senior Executive Editor of the Times of SF.",
    `You are filing for the ${desk} desk. ${deskNotes}`,
    "Your goal is to transform source facts into a readable, truth-seeking feature report (approx 1,200-1,700 words).",
    "Write with analytical authority, but stay strictly grounded in the provided source facts.",
    "CRITICAL: Do NOT invent or 'tailor' details to specific San Francisco neighborhoods (like the Mission or Financial District) unless they are explicitly mentioned in the source packets.",
    "Avoid flowery 'SF-themed' filler, clickbait, fake certainty, and hype phrases like 'shocking' or 'you won't believe'.",
    "Do not say the story is based on '200+ sources'; cite only the 3-8 sources actually provided and used.",
    "Copyright safety: extract facts, not prose. Do not mimic source wording, sentence structure, headline structure, or distinctive framing.",
    "Every factual claim must map to a source credit. Use inline citations like (Reuters) immediately after specific factual claims.",
    "Separate confirmed facts from analysis. Label uncertainty plainly and include what cannot be verified yet.",
    "Prefer primary documents, official statements, filings, and public data when present in the source packets.",
    "Use this bodyMarkdown structure with ### headers in this order:",
    "1. The News in One Sentence",
    "2. Why It Matters",
    "3. What Happened",
    "4. The Hidden Angle",
    "5. Who Benefits",
    "6. Who Loses",
    "7. What Sources Agree On",
    "8. What Sources Disagree On",
    "9. What Is Still Unknown",
    "10. Timeline",
    "11. Data / Chart",
    "12. Context",
    "13. What Happens Next",
    "14. Source Notes",
    "Use short paragraphs, bullets for dense facts, and one evidence-driven pull-quote or key-number moment.",
    "MANDATORY: Insert [CHART:0] naturally in the Data / Chart section if dataBlocks has usable data.",
    "dataBlocks can render four chart types: bar, histogram, scatter, and line. Use line when points should be connected over time; use scatter when points should remain unconnected.",
    "Each dataBlock must include type, title, xAxisLabel, yAxisLabel, and data.",
    "For bar/histogram data use {label, value}. For scatter/line data use numeric {x, y, label}.",
    "Chart axes must use concrete dimension names matched to the statistics you cite (examples: Year and Funding ($M), Quarter and Headcount, Agency and Budget share (%)).",
    "Never set xAxisLabel or yAxisLabel to generic placeholders like Category, Value, Series, Label, X, or Y.",
    "OUTPUT RULES: Your reply must be ONE valid JSON object only. Inside JSON strings, escape every double-quote as \\\" and represent line breaks as \\n — never paste multi-line raw prose inside a JSON string without escaping.",
    `Return JSON with keys: headline, slug, dek, bodyMarkdown, shortPost, credits, citations, entities, dataBlocks, editorialCategory.`,
    `editorialCategory must be exactly one of: Tech, Funding, Civics, Culture, Transit, Food, Events — use "${desk}" unless the sources clearly belong elsewhere.`,
    "credits must include sourceName, articleUrl, sourceType, publishedAt when known, confidence, and factBullets.",
    "citations must be an array of {claim, sourceName, sourceUrl, quoteOrFact} for the most important article claims.",
    "MANDATORY: Use double brackets like [[NVIDIA]] or [[Jane Doe]] for at least 10-15 key people, companies, agencies, products, or technical terms explicitly mentioned in the sources.",
    "Also include a 'tldr' object with keys: 'whyItMatters', 'whoIsAffected', and 'whatIsNext'.",
    "entities must be an array of {name, definition} for your bracketed terms.",
    "dataBlocks must be an array of {type, title, xAxisLabel, yAxisLabel, data} representing core statistics from the sources.",
    `Source packets (sanitized JSON): ${JSON.stringify(sanitizeSourcesForPrompt(sources))}`,
  ].join("\n");
}

function slugFragment(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return base || "wire";
}

export type BuildFallbackPostOptions = {
  synthesisError?: string;
  /** Use only fact bullets and bare links—helps pass phrase-overlap checks when fuller copy trips copyright safety. */
  copyrightMinimal?: boolean;
};

/**
 * When full LLM JSON synthesis fails, still ship something grounded: fact bullets + outbound links to primary reporting.
 */
export function buildFallbackPostFromSources(
  topic: TrendCandidate,
  sources: SourceExtraction[],
  opts?: BuildFallbackPostOptions,
): GeneratedPost {
  const synthesisError = opts?.synthesisError?.trim();
  const copyrightMinimal = opts?.copyrightMinimal ?? false;

  const desk: EditorialCategory = topic.editorialCategory ?? classifyEditorialCategory(topic);
  const primaryHeadline = sources[0]?.headline?.trim();
  const topicTitle = topic.topic?.trim();
  const headline =
    topicTitle && topicTitle.length > 12 ? topicTitle : primaryHeadline ?? topicTitle ?? "Wire dispatch";
  const slug = `${slugFragment(headline)}-${crypto.randomUUID().slice(0, 8)}`;

  const factLines: string[] = [];
  for (const s of sources) {
    for (const f of s.facts.slice(0, 14)) {
      const line = f.trim();
      if (line.length && !factLines.includes(line)) factLines.push(line);
    }
  }
  const cappedFacts = factLines.slice(0, 28);

  const credits = sources.map((s) => ({
    sourceName: s.sourceName,
    articleUrl: s.articleUrl,
    sourceType: s.sourceType,
    publishedAt: s.publishedAt,
    confidence: "high" as const,
    factBullets: s.facts.slice(0, 10),
  }));

  const citations = cappedFacts.slice(0, 10).map((claim, i) => {
    const src = sources[i % sources.length];
    return {
      claim,
      sourceName: src.sourceName,
      sourceUrl: src.articleUrl,
      quoteOrFact: claim,
    };
  });

  const errNote =
    synthesisError && synthesisError.length > 0
      ? `Automated long-form synthesis did not complete (${synthesisError.slice(0, 240)}). `
      : "";

  const bodyMarkdown = copyrightMinimal
    ? [
        "### Wire dispatch",
        "",
        `${errNote}Ultra-compact recap from extracted fact bullets only.`,
        "",
        "### Reported lines",
        "",
        ...sources
          .flatMap((s) => s.facts.slice(0, 10).map((f) => `- (${s.sourceName}) ${f.trim()}`))
          .slice(0, 30),
        "",
        "### Primary reporting",
        "",
        ...sources.map((s) => `- [${s.sourceName}](${s.articleUrl})`),
      ].join("\n")
    : [
        "### Wire dispatch",
        "",
        `${errNote}This brief is assembled directly from retrieved source packets so reporting still ships when synthesis is unavailable.`,
        "",
        "### What outlets report",
        "",
        ...cappedFacts.map((f) => `- ${f}`),
        "",
        "### Source list",
        "",
        ...sources.map((s) => `- **${s.sourceName}** — [Open article](${s.articleUrl})`),
      ].join("\n");

  const summaryBlob = sources
    .map((s) => s.summary)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);

  const dek =
    copyrightMinimal
      ? `Minimal attributed recap from ${sources.length} wire source(s).`
      : `Attributed recap from ${sources.length} wire source(s); full AI write-up unavailable this run.`;

  return {
    headline: headline.length > 140 ? `${headline.slice(0, 137)}…` : headline,
    slug,
    dek,
    bodyMarkdown,
    shortPost: `${headline.slice(0, 200)} — Times of SF wire recap with primary links.`,
    topic: topic.topic,
    editorialCategory: desk,
    credits,
    citations,
    tldr: {
      whyItMatters: summaryBlob || "Multiple outlets are covering this thread.",
      whoIsAffected: "Readers following regional and national developments cited below.",
      whatIsNext: "Follow the linked primary reporting for updates.",
    },
    entities: [],
    dataBlocks: [],
  };
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

async function synthesizeWithGemini(topic: TrendCandidate, sources: SourceExtraction[]) {
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
            text: buildPrompt(topic, sources),
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

async function synthesizeWithFireworks(topic: TrendCandidate, sources: SourceExtraction[]) {
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
            "You are a grounded newsroom writer. Return only valid JSON including editorialCategory (one of: Tech, Funding, Civics, Culture, Transit, Food, Events).",
        },
        {
          role: "user",
          content: buildPrompt(topic, sources),
        },
      ],
      temperature: 0.2,
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
  if (config.llmProvider === "fireworks") {
    return synthesizeWithFireworks(topic, sources);
  }

  return synthesizeWithGemini(topic, sources);
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
    A junior writer has provided a short dispatch. Please expand this into a full feature-length report (approx 1,200-1,700 words).
    Do not change the existing facts, but add analytical depth and explore the long-term implications.
    Maintain the existing professional, grounded editorial tone.
    
    CRITICAL: Do NOT invent or 'tailor' details to specific San Francisco neighborhoods unless they are explicitly mentioned in the dispatch.
    Copyright safety: do not mimic source wording, article structure, or distinctive phrasing. Keep facts attributed and analysis clearly separated.
    
    IMPORTANT: 
    1. Use double brackets like [[NVIDIA]] for companies, people, and tech terms—target at least 10 highlighted entities where the dispatch supports it. Prefer the entity list when provided, but you may introduce additional bracketed terms if they appear verbatim in the dispatch.
    2. Insert [CHART:index] where the data visualizations listed below would naturally fit.
    3. Return ONLY the new body content in Markdown. No headline, no titles.
    
    ${entityContext}
    ${chartContext}
    
    Current Dispatch:
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
