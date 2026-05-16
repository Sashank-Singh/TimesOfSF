/**
 * Integration test for knowledge state operations.
 * Run: npx tsx scratch/test-knowledge-state.ts
 *
 * Requires DATABASE_URL in .env or environment.
 */
import "../server/config";
import { ensureSchema, saveKnowledgeState, fetchRecentKnowledgeState, fetchRelatedKnowledge } from "../server/db";

const testPost = {
  headline: "Test Article: AI Startup Raises $500M",
  slug: "test-ai-startup-raises-500m",
  bodyMarkdown: "# Test article body",
  shortPost: "A test article for knowledge state verification.",
  topic: "AI Startup Raises $500M in Series D",
  editorialCategory: "Funding" as const,
  credits: [],
  citations: [],
  tldr: {
    whyItMatters: "Test",
    whoIsAffected: "Test",
    whatIsNext: "Test",
  },
  entities: [
    { name: "OpenAI", definition: "AI research company" },
    { name: "Sam Altman", definition: "CEO of OpenAI" },
    { name: "Series D", definition: "Late-stage funding round" },
  ],
  dataBlocks: [],
};

const testSources = [
  {
    sourceName: "TechCrunch" as const,
    articleUrl: "https://techcrunch.com/2026/05/test-article/",
    canonicalUrl: "https://techcrunch.com/2026/05/test-article/",
    headline: "AI Startup Raises $500M",
    summary: "AI startup raises $500M in Series D funding round led by major investors.",
    textExcerpt: "AI startup raises $500M in Series D funding round led by major investors. The company plans to use the funding to expand its research and development efforts.",
    facts: ["AI startup raises $500M in Series D funding round led by major investors.", "The company plans to use the funding to expand its research and development efforts."],
  },
];

async function main() {
  console.log("🔧 Ensuring schema...");
  await ensureSchema();

  console.log("💾 Saving knowledge state entry...");
  await saveKnowledgeState(testPost, testPost.topic, testSources);

  console.log("📖 Fetching recent knowledge state...");
  const recent = await fetchRecentKnowledgeState(5);
  console.log(`  Found ${recent.length} entries`);

  // Find our test entry
  const ours = recent.find((r) => r.headline === testPost.headline);
  if (!ours) {
    console.error("  ❌ Could not find the saved entry in recent results!");
    process.exit(1);
  }
  console.log(`  ✅ Found entry: "${ours.headline}"`);
  console.log(`  Category: ${ours.category}`);
  console.log(`  Entities: ${ours.keyEntities.join(", ")}`);
  console.log(`  Facts: ${ours.keyFacts.length}`);
  console.log(`  Source URLs: ${ours.sourceUrls.length}`);

  console.log("\n🔍 Testing fetchRelatedKnowledge...");
  const related = await fetchRelatedKnowledge("Funding", ["OpenAI", "Sam Altman"]);
  console.log(`  Found ${related.length} related entries`);
  if (related.length > 0) {
    console.log(`  ✅ Related: "${related[0].headline}"`);
  }

  // Cleanup: delete our test entries from knowledge_state
  console.log("\n🧹 Cleaning up test entries...");
  const { neon } = await import("@neondatabase/serverless");
  const { config } = await import("../server/config");
  const sql = neon(config.databaseUrl);
  await sql`DELETE FROM knowledge_state WHERE headline = ${testPost.headline}`;
  console.log("  ✅ Cleanup complete");

  console.log("\n===== All knowledge state tests passed! =====");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
