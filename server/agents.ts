import { GoogleGenAI, Type } from "@google/genai";
import { config } from "./config";
import { GeneratedPost, SourceExtraction, TrendCandidate } from "./types";

const geminiAi = config.geminiApiKey ? new GoogleGenAI({ apiKey: config.geminiApiKey }) : null;

function buildPrompt(topic: TrendCandidate, sources: SourceExtraction[]) {
  return [
    "You are the Senior Executive Editor of the Times of SF.",
    "Your goal is to transform dry source facts into a feature-length, narrative-driven report (approx 800-1000 words).",
    "Write with analytical authority, staying strictly grounded in the provided source facts.",
    "CRITICAL: Do NOT invent or 'tailor' details to specific San Francisco neighborhoods (like the Mission or Financial District) unless they are explicitly mentioned in the source packets.",
    "Avoid flowery 'SF-themed' filler; focus on the actual news, business, and policy implications.",
    "Structure the report into four distinct, titled sections (use ### headers):",
    "1. The Dispatch: The immediate news and its primary impact.",
    "2. The Context: Historical background or broader industry trends that explain the situation.",
    "3. The Data Insight: A rigorous analysis of the underlying numbers (MANDATORY: Insert [CHART:0] at the end of this section).",
    "4. The Horizon: Long-term implications and the future outlook.",
    "Return JSON with keys: headline, slug, dek, bodyMarkdown, shortPost, credits, entities, dataBlocks.",
    "IMPORTANT: Use inline citations throughout the text like (Source Name) when referencing facts.",
    "bodyMarkdown should be structured with semantic headers and balanced paragraphs.",
    "MANDATORY: Use double brackets like [[NVIDIA]] or [[Jane Doe]] for at least 5-8 key people, companies, or tech terms explicitly mentioned in the sources.",
    "Also include a 'tldr' object with keys: 'whyItMatters', 'whoIsAffected', and 'whatIsNext'.",
    "entities must be an array of {name, definition} for your bracketed terms.",
    "dataBlocks must be an array of {type: 'chart', title, data: [{label, value}]} representing core statistics from the sources.",
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
    entities: parsed.entities,
    dataBlocks: parsed.dataBlocks,
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
                data: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      value: { type: Type.NUMBER },
                    },
                    required: ["label", "value"],
                  },
                },
              },
              required: ["type", "title", "data"],
            },
          },
        },
        required: ["headline", "slug", "dek", "bodyMarkdown", "shortPost", "credits", "tldr", "entities", "dataBlocks"],
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
    A junior writer has provided a short dispatch. Please expand this into a full feature-length report (approx 800-1000 words).
    Do not change the existing facts, but add analytical depth and explore the long-term implications.
    Maintain the existing professional, grounded editorial tone.
    
    CRITICAL: Do NOT invent or 'tailor' details to specific San Francisco neighborhoods unless they are explicitly mentioned in the dispatch.
    
    IMPORTANT: 
    1. Use double brackets like [[NVIDIA]] for companies, people, and tech terms. Only use them for the available entities listed below if provided.
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
