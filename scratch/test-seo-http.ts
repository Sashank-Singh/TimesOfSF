/**
 * Live HTTP smoke for SEO HTML injection without Postgres.
 * Serves dist/ with the same injectors used in production.
 * Run: npx tsx scratch/test-seo-http.ts
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVERGREEN_GUIDES_SEO,
  injectListPageMetadata,
  resolveCategoryFromSlug,
  type ListPageKind,
} from "../server/seoPages.ts";
import { ALL_EDITORIAL_CATEGORIES } from "../server/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const indexHtmlPath = path.join(distDir, "index.html");
const PORT = 8799;

if (!fs.existsSync(indexHtmlPath)) {
  console.error("dist/index.html missing — run npm run build first");
  process.exit(1);
}

const sampleItems = [
  { headline: "Clipper fare debate hits City Hall", slug: "clipper-fare-debate", dek: "Supervisors weigh options.", category: "Transit" },
  { headline: "Mission opening draws lines", slug: "mission-opening", dek: "New counter in the Mission.", category: "Food" },
];

const app = express();
const readIndex = () => fs.promises.readFile(indexHtmlPath, "utf8");

async function sendList(res: express.Response, page: ListPageKind) {
  const html = injectListPageMetadata(await readIndex(), page, sampleItems);
  res.type("html").send(html);
}

app.get("/", (_req, res) => sendList(res, { kind: "home" }));
app.get("/events", (_req, res) => sendList(res, { kind: "events" }));
app.get("/digest", (_req, res) => sendList(res, { kind: "digest" }));
app.get("/category/:slug", async (req, res) => {
  const category = resolveCategoryFromSlug(req.params.slug);
  if (!category) {
    res.status(404).send("unknown category");
    return;
  }
  await sendList(res, { kind: "category", category });
});
app.get("/guides/:slug", async (req, res) => {
  const guide = EVERGREEN_GUIDES_SEO.find((g) => g.slug === req.params.slug);
  if (!guide) {
    res.status(404).send("unknown guide");
    return;
  }
  await sendList(res, {
    kind: "guide",
    slug: guide.slug,
    title: guide.title,
    description: guide.description,
    updatedAt: guide.updatedAt,
  });
});

app.get("/sitemap.xml", (_req, res) => {
  const base = `http://127.0.0.1:${PORT}`;
  const urls = [
    "/",
    "/events",
    "/digest",
    ...ALL_EDITORIAL_CATEGORIES.map((c) => `/category/${c.toLowerCase()}`),
    ...EVERGREEN_GUIDES_SEO.map((g) => `/guides/${g.slug}`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n")}
</urlset>`;
  res.type("application/xml").send(body);
});

app.use(express.static(distDir));

const server = app.listen(PORT, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${PORT}`;
  let pass = 0;
  let fail = 0;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      pass++;
      console.log("PASS", msg);
    } else {
      fail++;
      console.error("FAIL", msg);
    }
  };

  async function check(pathName: string, expect: string[]) {
    const res = await fetch(`${base}${pathName}`);
    const text = await res.text();
    assert(res.status === 200, `${pathName} status 200`);
    for (const needle of expect) {
      assert(text.includes(needle), `${pathName} contains ${needle}`);
    }
    return text;
  }

  await check("/category/transit", [
    'rel="canonical"',
    "/category/transit",
    "seo-ssr",
    "Clipper fare debate",
    "og:title",
    "application/ld+json",
  ]);
  await check("/events", ["/events", "events calendar", "seo-ssr"]);
  await check("/digest", ["/digest", "Best of SF", "seo-ssr"]);
  await check("/guides/how-muni-works", ["/guides/how-muni-works", "How Muni works", "seo-ssr"]);
  await check("/", ["Times of San Francisco", "/category/tech", "/digest"]);
  const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
  assert(sitemap.includes("/category/tech"), "sitemap has /category/tech");
  assert(sitemap.includes("/guides/how-muni-works"), "sitemap has guide");
  assert(sitemap.includes("/events"), "sitemap has events");

  // SPA client assets still served
  const assetRes = await fetch(`${base}/`);
  assert(assetRes.headers.get("content-type")?.includes("html") === true, "home content-type html");

  console.log("\nHTTP RESULT", { pass, fail });
  server.close();
  process.exit(fail ? 1 : 0);
});
