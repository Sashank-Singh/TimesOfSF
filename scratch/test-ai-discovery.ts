/**
 * Offline tests for AI citation / discovery surfaces.
 * Run: npx tsx scratch/test-ai-discovery.ts
 */
import {
  buildArticleMarkdown,
  buildArticlePlainText,
  buildArticleSeoBootstrap,
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildRobotsTxt,
  buildRssFeed,
  citationHeadTags,
} from "../server/aiDiscovery.ts";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log("PASS", msg);
  } else {
    fail++;
    console.error("FAIL", msg);
  }
}

const sample = {
  headline: "Muni delay plan advances",
  slug: "muni-delay-plan",
  dek: "Board weighs evening frequency cuts.",
  body_markdown: "## What happened\n\nThe SFMTA board advanced a draft plan.\n\nQuote me.",
  category: "Transit",
  created_at: "2026-07-19T12:00:00.000Z",
};

const robots = buildRobotsTxt();
assert(robots.includes("GPTBot"), "robots allows GPTBot");
assert(robots.includes("ClaudeBot"), "robots allows ClaudeBot");
assert(robots.includes("PerplexityBot"), "robots allows PerplexityBot");
assert(robots.includes("llms.txt"), "robots points to llms.txt");
assert(robots.includes("Sitemap:"), "robots has sitemap");

const llms = buildLlmsTxt([sample]);
assert(llms.includes("Times of San Francisco"), "llms title");
assert(llms.includes("/articles/muni-delay-plan"), "llms article link");
assert(llms.includes("feed.xml"), "llms lists RSS");
assert(llms.includes("Citation policy"), "llms citation policy");

const full = buildLlmsFullTxt([sample]);
assert(full.includes("Muni delay plan advances"), "llms-full headline");
assert(full.includes("SFMTA board"), "llms-full body excerpt");

const md = buildArticleMarkdown(sample);
assert(md.includes("canonical:"), "md frontmatter canonical");
assert(md.includes("Quote with attribution"), "md attribution");
assert(md.includes("SFMTA board"), "md body");

const txt = buildArticlePlainText(sample);
assert(txt.includes("Canonical URL:"), "txt canonical");
assert(txt.includes("Times of San Francisco"), "txt publisher");

const rss = buildRssFeed([sample]);
assert(rss.includes("<rss"), "rss root");
assert(rss.includes("muni-delay-plan"), "rss item link");
assert(rss.includes("Quote with attribution"), "rss copyright quote policy");

const boot = buildArticleSeoBootstrap(sample);
assert(boot.includes("seo-ssr"), "bootstrap id");
assert(boot.includes("Cite as:"), "bootstrap cite line");
assert(boot.includes(".md"), "bootstrap md link");
assert(boot.includes("SFMTA board"), "bootstrap body");

const cite = citationHeadTags("https://example.com/articles/x");
assert(cite.includes("citation_publisher"), "citation meta");
assert(cite.includes("feed.xml"), "rss alternate");
assert(cite.includes("ai-content"), "ai-content meta");

console.log("\nRESULT", { pass, fail });
if (fail) process.exit(1);
