import { GoogleGenAI, Type } from "@google/genai";
import { config } from "./config";
import { GeneratedPost, SourceExtraction, TrendCandidate } from "./types";

const geminiAi = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

function buildPrompt(topic: TrendCandidate, sources: SourceExtraction[]) {
  return [
    "You are the Times of SF grounded writer agent.",
    "Write only from the provided source packets.",
    "Do not invent facts, names, timelines, quotes, valuations, or context not present in the evidence.",
    "If evidence is insufficient, the caller will reject the run, so still return your best grounded output from the evidence only.",
    `Topic: ${topic.topic}`,
    "Return JSON with keys: headline, slug, dek, bodyMarkdown, shortPost, credits.",
    "credits must be an array with sourceName, articleUrl, factBullets.",
    "bodyMarkdown should be publication-ready, concise, and cite uncertainty when sources differ.",
    `Source packets: ${JSON.stringify(sources)}`,
  ].join("\n");
}

function normalizePost(topic: TrendCandidate, parsed: any): GeneratedPost {
  return {
    headline: parsed.headline,
    slug: parsed.slug,
    dek: parsed.dek,
    bodyMarkdown: parsed.bodyMarkdown,
    shortPost: parsed.shortPost,
    topic: topic.topic,
    credits: parsed.credits,
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
                factBullets: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["sourceName", "articleUrl", "factBullets"],
            },
          },
        },
        required: ["headline", "slug", "dek", "bodyMarkdown", "shortPost", "credits"],
      },
    },
  });

  const parsed = JSON.parse(response.text ?? "{}");
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
          content: "You are a grounded newsroom writer. Return only valid JSON.",
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

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Fireworks response did not include message content.");
  }

  const parsed = JSON.parse(content);
  return normalizePost(topic, parsed);
}

export async function synthesizePost(topic: TrendCandidate, sources: SourceExtraction[]): Promise<GeneratedPost> {
  if (config.llmProvider === "fireworks") {
    return synthesizeWithFireworks(topic, sources);
  }

  return synthesizeWithGemini(topic, sources);
}
