import { synthesizePost } from "../server/agents";
import { SourceExtraction, TrendCandidate } from "../server/types";
import dotenv from "dotenv";

dotenv.config();

const mockTopic: TrendCandidate = {
  topic: "The Waymo Expansion: San Francisco's Autonomous Grid",
  normalizedTopic: "waymo expansion san francisco autonomous grid",
  signalCount: 10,
  sampleHeadlines: ["Waymo increases SF fleet", "Autonomous vehicles reach new milestones in Bay Area"]
};

const mockSources: SourceExtraction[] = [
  {
    sourceName: "TechCrunch",
    articleUrl: "https://techcrunch.com/waymo-sf",
    canonicalUrl: "https://techcrunch.com/waymo-sf",
    headline: "Waymo's SF Fleet Hits 500,000 Weekly Trips",
    imageUrl: "https://images.unsplash.com/photo-1620712943543-bcc4628c9456",
    summary: "Waymo has announced a massive surge in ridership in San Francisco, surpassing half a million trips per week.",
    textExcerpt: "Waymo today announced that its autonomous taxi service in San Francisco has reached a new milestone. The company now facilitates over 500,000 trips every seven days across the city's 49 square miles. Expansion into the Peninsula and East Bay is also being considered as reliability metrics improve.",
    facts: [
      "Waymo facilitates 500,000 trips per week in SF.",
      "The service operates across all 49 square miles of the city.",
      "Reliability metrics have improved by 15% year-over-year.",
      "Expansion to the Peninsula is under evaluation."
    ]
  }
];

async function run() {
  console.log("📝 Generating high-fidelity feature article example...");
  try {
    const article = await synthesizePost(mockTopic, mockSources);
    console.log("\n==================================================");
    console.log(`HEADLINE: ${article.headline}`);
    console.log(`DEK: ${article.dek}`);
    console.log("==================================================\n");
    console.log(article.bodyMarkdown);
    console.log("\n==================================================");
    console.log("TL;DR:");
    console.log(`Why it matters: ${article.tldr?.whyItMatters}`);
    console.log(`What's next: ${article.tldr?.whatIsNext}`);
    console.log("==================================================");
  } catch (err) {
    console.error("Failed to generate example:", err);
  }
}

run();
