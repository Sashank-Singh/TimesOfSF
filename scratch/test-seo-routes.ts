/**
 * Offline SEO / monetization smoke tests (no DB, no Vite).
 * Run: npx tsx scratch/test-seo-routes.ts
 */
import { parseAppPath, categoryPath, CATEGORY_SEO, slugToCategory, entityToTopicSlug } from "../src/lib/routes.ts";
import { getGuideBySlug, EVERGREEN_GUIDES } from "../src/content/evergreen.ts";
import {
  injectListPageMetadata,
  listPageMeta,
  EVERGREEN_GUIDES_SEO,
  resolveCategoryFromSlug,
} from "../server/seoPages.ts";
import { sponsorsFor, jobsForDesk, affiliatesForGuide } from "../src/content/monetization.ts";

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

assert(parseAppPath("/category/transit").kind === "category", "parse /category/transit");
assert((parseAppPath("/category/transit") as { category: string }).category === "Transit", "Transit category");
assert(parseAppPath("/events").kind === "events", "parse /events");
assert(parseAppPath("/digest").kind === "digest", "parse /digest");
assert(parseAppPath("/guides/how-muni-works").kind === "guide", "parse guide");
assert(parseAppPath("/topics/muni").kind === "topic", "parse topic");
assert(parseAppPath("/articles/hello-world").kind === "article", "parse article");
assert(categoryPath("Tech") === "/category/tech", "categoryPath Tech");
assert(slugToCategory("funding") === "Funding", "slugToCategory");
assert(CATEGORY_SEO.Transit.title.includes("Transit"), "CATEGORY_SEO Transit");
assert(entityToTopicSlug("OpenAI") === "openai", "entityToTopicSlug");

assert(EVERGREEN_GUIDES.length >= 4, "evergreen count >= 4");
assert(getGuideBySlug("how-muni-works")?.slug === "how-muni-works", "getGuideBySlug");
assert(EVERGREEN_GUIDES_SEO.some((g) => g.slug === "weekend-in-sf"), "server guide seo");

assert(resolveCategoryFromSlug("tech") === "Tech", "resolveCategoryFromSlug");
assert(listPageMeta({ kind: "events" }).canonicalPath === "/events", "events canonical");
assert(listPageMeta({ kind: "category", category: "Transit" }).canonicalPath === "/category/transit", "category canonical");
assert(listPageMeta({ kind: "digest" }).canonicalPath === "/digest", "digest canonical");
assert(
  listPageMeta({
    kind: "guide",
    slug: "how-muni-works",
    title: "How Muni works",
    description: "x",
    updatedAt: "2026-07-01",
  }).canonicalPath === "/guides/how-muni-works",
  "guide canonical",
);

const html = injectListPageMetadata(
  `<html><head><title>x</title><meta name="description" content="d" /><link rel="canonical" href="/" /></head><body><div id="root"></div></body></html>`,
  { kind: "category", category: "Tech" },
  [{ headline: "SF AI Story", slug: "sf-ai-story", dek: "Dek here", category: "Tech" }],
);
assert(html.includes("/category/tech"), "inject canonical category");
assert(html.includes("SF AI Story"), "inject bootstrap headline");
assert(html.includes('id="seo-ssr"'), "inject seo-ssr");
assert(html.includes("/articles/sf-ai-story"), "inject article link");
assert(html.includes("og:title"), "inject og:title");
assert(html.includes("application/ld+json"), "inject json-ld");

const homeHtml = injectListPageMetadata(
  `<html><head><title>x</title></head><body><div id="root"></div></body></html>`,
  { kind: "home" },
  [],
);
assert(homeHtml.includes("/events") && homeHtml.includes("/digest"), "home bootstrap section links");

assert(sponsorsFor("homepage").length >= 1, "homepage sponsors");
assert(sponsorsFor("events").length >= 1, "events sponsors");
assert(jobsForDesk("Tech").length >= 1, "tech jobs");
assert(affiliatesForGuide("how-muni-works").length >= 1, "muni affiliates");

console.log("\nRESULT", { pass, fail });
if (fail) process.exit(1);
