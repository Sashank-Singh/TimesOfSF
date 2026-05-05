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
    "Also include a 'tldr' object with three keys: 'whyItMatters' (concise impact statement, including funding amounts/valuations if applicable), 'whoIsAffected' (specific stakeholders or investors), and 'whatIsNext' (actionable next steps or timeline).",
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
    tldr: parsed.tldr,
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
          tldr: {
            type: Type.OBJECT,
            properties: {
              whyItMatters: { type: Type.STRING },
              whoIsAffected: { type: Type.STRING },
              whatIsNext: { type: Type.STRING },
            },
            required: ["whyItMatters", "whoIsAffected", "whatIsNext"],
          },
        },
        required: ["headline", "slug", "dek", "bodyMarkdown", "shortPost", "credits", "tldr"],
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

  const parsed = JSON.parse(content);
  return normalizePost(topic, parsed);
}

export async function synthesizePost(topic: TrendCandidate, sources: SourceExtraction[]): Promise<GeneratedPost> {
  if (config.llmProvider === "fireworks") {
    return synthesizeWithFireworks(topic, sources);
  }

  return synthesizeWithGemini(topic, sources);
}

export async function expandContent(headline: string, currentContent: string): Promise<string> {
  const prompt = `
    You are the Times of SF senior editor. 
    A junior writer has provided a short dispatch. Please expand this into a full feature-length report.
    Do not change the existing facts, but add analytical depth, historical context of San Francisco, and explore the long-term implications.
    Maintain the existing professional, grounded editorial tone.
    Return ONLY the new body content in Markdown. No headline, no titles.
    
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
    return data.choices[0].message.content;
  }

  if (!geminiAi) throw new Error("GEMINI_API_KEY not configured.");
  const model = geminiAi.getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent(prompt);
  return result.response.text();
}
