/**
 * Quick smoke-test for readability extraction on real article URLs.
 * Run: npx tsx scratch/test-readability.ts
 */
import { extractWithReadabilityFallback, extractNumericFacts } from "../server/articleExtractor";

const testUrls = [
  {
    sourceName: "TechCrunch" as const,
    articleUrl: "https://techcrunch.com/2026/05/03/this-is-fine-creator-says-ai-startup-stole-his-art/",
    headline: "This is Fine creator says AI startup stole his art",
    summary: "The creator of the popular 'This is Fine' comic is suing an AI startup for copyright infringement.",
  },
  {
    sourceName: "TechCrunch" as const,
    articleUrl: "https://techcrunch.com/2026/05/04/katie-haun-raises-1-billion-for-new-venture-funds/",
    headline: "Katie Haun raises $1 billion for new venture funds",
    summary: "Haun Ventures has raised $1 billion across two new funds.",
  },
];

async function main() {
  let passed = 0;
  let failed = 0;

  for (const input of testUrls) {
    console.log(`\n--- Testing: ${input.sourceName} ---`);
    console.log(`URL: ${input.articleUrl}`);

    try {
      const result = await extractWithReadabilityFallback(input);
      console.log(`  Headline: ${result.headline.slice(0, 100)}`);
      console.log(`  Summary/excerpt: ${result.summary.slice(0, 150)}`);
      console.log(`  textExcerpt length: ${result.textExcerpt.length} chars`);
      console.log(`  Facts count: ${result.facts.length}`);
      if (result.facts.length > 0) {
        console.log(`  First fact: ${result.facts[0].slice(0, 150)}`);
      }

      // Test numeric fact extraction
      const numericFacts = extractNumericFacts(result.textExcerpt);
      console.log(`  Numeric facts found: ${numericFacts.length}`);
      if (numericFacts.length > 0) {
        console.log(`  Numeric facts: ${numericFacts.slice(0, 5).join(" | ")}`);
      }

      // Basic quality checks
      const checks = [
        { name: "headline not empty", pass: result.headline.length > 10 },
        { name: "has substantial text excerpt", pass: result.textExcerpt.length > 500 },
        { name: "has at least 2 facts", pass: result.facts.length >= 2 },
        { name: "summary not empty", pass: result.summary.length > 10 },
      ];

      let allPassed = true;
      for (const check of checks) {
        const status = check.pass ? "✅" : "❌";
        console.log(`  ${status} ${check.name}`);
        if (!check.pass) allPassed = false;
      }
      if (allPassed) passed++; else failed++;
    } catch (err) {
      console.error(`  ❌ Extraction failed: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n===== Results: ${passed} passed, ${failed} failed =====`);
  process.exit(failed > 0 && passed === 0 ? 1 : 0);
}

main();
