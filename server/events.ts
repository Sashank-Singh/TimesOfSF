import { config } from "./config";

export interface EventInfo {
  title: string;
  url: string;
  date: string;
  source: string;
}

export async function fetchEvents(): Promise<EventInfo[]> {
  try {
    const searchUrl = "https://news.google.com/rss/search?q=upcoming+tech+AI+events+San+Francisco+when:7d&hl=en-US&gl=US&ceid=US:en";
    const res = await fetch(searchUrl);
    const xml = await res.text();

    const prompt = `
You are an event extraction bot. Extract the top 6 upcoming tech/AI events in San Francisco mentioned in this RSS feed text.
If there are no explicit events, infer them from the news (e.g., "Company X's AI Summit").
Return ONLY valid JSON in this format:
{
  "events": [
    {
      "title": "Event Name",
      "url": "https://lu.ma/event-id or real url",
      "date": "May 10, 2026",
      "source": "Luma / Cerebral Valley"
    }
  ]
}

RSS Feed content:
${xml.substring(0, 8000)}
    `;

    if (!config.fireworksApiKey) {
      throw new Error("FIREWORKS_API_KEY is missing");
    }

    const llmRes = await fetch(`${config.fireworksBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.fireworksApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.fireworksModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!llmRes.ok) throw new Error("LLM failed to extract events");

    const data = await llmRes.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content || '{"events": []}');

    return parsed.events || [];
  } catch (err) {
    console.error("Failed to extract events via LLM:", err);
    return [];
  }
}
