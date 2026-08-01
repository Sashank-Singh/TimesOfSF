import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildOwnerArticleIngestPageHtml } from "./ownerAdminHtml";
import { config, isProduction } from "./config";
import { ALL_EDITORIAL_CATEGORIES } from "./types";
import {
  EVERGREEN_GUIDES_SEO,
  injectListPageMetadata,
  resolveCategoryFromSlug,
  type ListPageKind,
} from "./seoPages";
import {
  buildArticleMarkdown,
  buildArticlePlainText,
  buildArticleSeoBootstrap,
  buildLlmsFullTxt,
  buildLlmsTxt,
  buildRobotsTxt,
  buildRssFeed,
  citationHeadTags,
} from "./aiDiscovery";
import {
  ensureSchema,
  fetchPipelineActivitySummary,
  fetchPostById,
  fetchPostBySlug,
  fetchPostSlugDatesForSitemap,
  fetchPostsForSeoList,
  fetchRecentPosts,
  fetchRun,
} from "./db";
import { generateSessionToken, hashPassword, verifyPassword, SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./auth";
import { runPipeline } from "./pipeline";
import { buildAndSendDigest, dueDigestSlot, isNewsletterSenderConfigured, type DigestSlot } from "./newsletter";

function shouldRunInternalPipelineTimer(): boolean {
  if (config.disableInternalPipelineCron) return false;
  return true;
}

function shouldRunNewsletterTimer(): boolean {
  return isNewsletterSenderConfigured();
}

const TTS_INLINE_MAX_CHARS = 8_000;
const TTS_FULL_ARTICLE_MAX_CHARS = 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const NEWSLETTER_CATEGORY_SET = new Set<string>(ALL_EDITORIAL_CATEGORIES);
const NEWSLETTER_CATEGORY_ALIASES: Record<string, string> = {
  civic: "Civics",
  civics: "Civics",
  political: "Civics",
  politics: "Civics",
};

function normalizeNewsletterPreference(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const alias = NEWSLETTER_CATEGORY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  const matched = ALL_EDITORIAL_CATEGORIES.find((category) => category.toLowerCase() === trimmed.toLowerCase());
  return matched ?? null;
}

function timingSafeSecret(ok: string | undefined, got: string | undefined): boolean {
  if (!ok || !got) return false;
  try {
    const a = Buffer.from(ok, "utf8");
    const b = Buffer.from(got, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function requestSecret(req: express.Request): string | undefined {
  const auth = req.header("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const headerSecret = req.header("x-admin-secret") ?? req.header("x-cron-secret");
  if (headerSecret) return headerSecret.trim();
  const querySecret = typeof req.query.secret === "string" ? req.query.secret : undefined;
  if (querySecret) return querySecret.trim();
  const bodySecret = typeof req.body?.secret === "string" ? req.body.secret : undefined;
  return bodySecret?.trim();
}

function isOwnerAuthorized(req: express.Request): boolean {
  return timingSafeSecret(config.ownerCliSecret, requestSecret(req));
}

function isCronAuthorized(req: express.Request): boolean {
  return timingSafeSecret(config.cronSecret, requestSecret(req));
}

function requireOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isOwnerAuthorized(req)) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

function requireOwnerOrCron(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isOwnerAuthorized(req) || isCronAuthorized(req)) {
    next();
    return;
  }
  res.status(401).json({ ok: false, error: "Unauthorized" });
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: { id: number; email: string; preferences: string[] };
    }
  }
}

async function requireSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ ok: false, error: "Not signed in" });
    return;
  }
  try {
    const { findSessionUser } = await import("./db");
    const user = await findSessionUser(token);
    if (!user) {
      res.status(401).json({ ok: false, error: "Not signed in" });
      return;
    }
    req.sessionUser = { id: user.id, email: user.email, preferences: user.preferences };
    next();
  } catch (error) {
    console.error("requireSession:", error);
    res.status(500).json({ ok: false, error: "Session check failed" });
  }
}

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

function rateLimit(name: string, max: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${name}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000).toString());
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sitemapLastmod(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = typeof value === "string" ? value : "";
  if (!s) return new Date().toISOString().slice(0, 10);
  return s.slice(0, 10);
}

function absolutePublicUrl(pathname: string): string {
  const base = config.appUrl.replace(/\/+$/, "");
  return `${base}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function originVariants(rawUrl: string): string[] {
  try {
    const url = new URL(rawUrl);
    const origins = new Set([url.origin]);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      origins.add(url.origin);
    } else {
      url.hostname = `www.${url.hostname}`;
      origins.add(url.origin);
    }
    return [...origins];
  } catch {
    return [];
  }
}

function articlePath(slug: string): string {
  return `/articles/${encodeURIComponent(slug)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildArticleHeadTags(post: any): string {
  const title = `${post.headline} | Times of SF`;
  const description = String(post.dek || post.short_post || "").trim() || "Read this article on Times of San Francisco.";
  const url = absolutePublicUrl(articlePath(post.slug));
  const rawImage = typeof post.image_url === "string" ? post.image_url.trim() : "";
  const image = rawImage
    ? (rawImage.startsWith("http") ? rawImage : absolutePublicUrl(rawImage))
    : absolutePublicUrl("/default-og.svg");
  const published = post.created_at instanceof Date
    ? post.created_at.toISOString()
    : typeof post.created_at === "string"
      ? post.created_at
      : new Date().toISOString();
  const updatedRaw = post.updated_at ?? post.updatedAt;
  const modified = updatedRaw instanceof Date
    ? updatedRaw.toISOString()
    : typeof updatedRaw === "string" && updatedRaw
      ? updatedRaw
      : published;
  const category = typeof post.category === "string" && post.category.trim() ? post.category.trim() : "News";
  const bodyText: string = typeof post.body_markdown === "string" ? post.body_markdown : "";
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const readTimeMin = Math.max(1, Math.round(wordCount / 200));

  // Parse entities from the post if available
  let entities: Array<{ name: string; definition?: string }> = [];
  try {
    const raw = post.entities;
    if (Array.isArray(raw)) entities = raw.slice(0, 10);
    else if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entities = parsed.slice(0, 10);
    }
  } catch { /* ignore */ }

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: `${category} news`, item: absolutePublicUrl(`/category/${encodeURIComponent(category.toLowerCase())}`) },
      { "@type": "ListItem", position: 2, name: post.headline },
    ],
  };

  const articleLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.headline,
    description,
    datePublished: published,
    dateModified: modified,
    wordCount,
    timeRequired: `PT${readTimeMin}M`,
    url,
    image: [image],
    author: { "@type": "Organization", name: "Times of SF" },
    publisher: {
      "@type": "NewsMediaOrganization",
      name: "Times of San Francisco",
      logo: {
        "@type": "ImageObject",
        url: absolutePublicUrl("/favicon.svg"),
      },
    },
    mainEntityOfPage: url,
    articleSection: category,
    keywords: [category, ...entities.map((e) => e.name)],
    about: { "@type": "Thing", name: category },
    inLanguage: "en-US",
    isAccessibleForFree: true,
    copyrightHolder: { "@type": "NewsMediaOrganization", name: "Times of San Francisco" },
    license: absolutePublicUrl("/llms.txt"),
    usageInfo: "Free to quote with attribution and a link to the canonical article URL.",
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["#article-headline", ".article-lead", ".tldr-answer-engine", ".article-body"],
    },
  };

  if (entities.length > 0) {
    articleLd.mentions = entities.map((e) => ({
      "@type": "Thing",
      name: e.name,
      ...(e.definition ? { description: e.definition } : {}),
    }));
  }

  const jsonLd = JSON.stringify({ "@graph": [articleLd, breadcrumbLd] }).replace(/</g, "\\u003c");

  const tagMetas = entities.slice(0, 5).map((e) =>
    `<meta property="article:tag" content="${escapeHtml(e.name)}" />`
  );

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="Times of San Francisco" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="article:published_time" content="${escapeHtml(published)}" />`,
    `<meta property="article:modified_time" content="${escapeHtml(modified)}" />`,
    `<meta property="article:section" content="${escapeHtml(category)}" />`,
    ...tagMetas,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    citationHeadTags(url),
    `<link rel="alternate" type="text/markdown" href="${escapeHtml(url)}.md" title="Markdown for AI citation" />`,
    `<link rel="alternate" type="text/plain" href="${escapeHtml(url)}.txt" title="Plain text for AI citation" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join("\n    ");
}

function injectArticleMetadata(indexHtml: string, post: any): string {
  const articleTags = buildArticleHeadTags(post);
  const bootstrap = buildArticleSeoBootstrap(post);
  let html = indexHtml;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  html = html.replace(/<meta\s+name="description"[\s\S]*?>/i, "");
  html = html.replace(/<link\s+rel="canonical"[\s\S]*?>/i, "");
  html = html.replace(/<meta\s+property="og:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace(/<meta\s+name="twitter:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace(/<meta\s+property="article:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace("</head>", `    ${articleTags}\n  </head>`);
  if (html.includes('<div id="root"></div>')) {
    html = html.replace('<div id="root"></div>', `${bootstrap}\n    <div id="root"></div>`);
  } else {
    html = html.replace("<body>", `<body>${bootstrap}`);
  }
  return html;
}

async function resolveLegacyArticleTarget(articleIdOrSlug: unknown) {
  if (typeof articleIdOrSlug !== "string") return null;
  const raw = articleIdOrSlug.trim();
  if (!raw) return null;

  const bySlug = await fetchPostBySlug(raw);
  if (bySlug) return bySlug;

  return fetchPostById(raw);
}

async function start() {
  await ensureSchema();

  const app = express();
  let corsOrigins = config.corsAllowedOrigins;
  if (corsOrigins.length === 0 && isProduction()) {
    corsOrigins = originVariants(config.appUrl);
  }
  app.use(
    cors(
      corsOrigins.length > 0
        ? {
            origin(origin, callback) {
              if (!origin) {
                callback(null, true);
                return;
              }
              if (corsOrigins.includes(origin)) {
                callback(null, true);
                return;
              }
              callback(null, false);
            },
            methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
            credentials: true,
            maxAge: 86_400,
          }
        : { origin: true, credentials: true },
    ),
  );
  app.use(express.json({ limit: "256kb" }));

  app.post("/api/admin/article-from-url", async (req, res) => {
    if (!config.ownerCliSecret) {
      res.status(503).json({
        ok: false,
        error: "Set OWNER_CLI_SECRET in server environment to enable this endpoint.",
      });
      return;
    }
    const { assertArticleFromUrlAuthorized, publishArticleFromSubmittedUrl } = await import("./articleFromUrl");
    const secret = typeof req.body?.secret === "string" ? req.body.secret : "";
    if (!assertArticleFromUrlAuthorized(secret)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) {
      res.status(400).json({ ok: false, error: "Missing url" });
      return;
    }
    const rawCat = typeof req.body?.editorialCategory === "string" ? req.body.editorialCategory.trim() : "";
    const { ALL_EDITORIAL_CATEGORIES } = await import("./types");
    type Cat = (typeof ALL_EDITORIAL_CATEGORIES)[number];
    const editorialCategory = ALL_EDITORIAL_CATEGORIES.includes(rawCat as Cat) ? (rawCat as Cat) : undefined;
    try {
      const result = await publishArticleFromSubmittedUrl(url, { editorialCategory });
      let slug: string | undefined;
      if (result.published && result.postId) {
        const { fetchPostById } = await import("./db");
        const row = await fetchPostById(result.postId);
        slug = row?.slug as string | undefined;
      }
      res.status(result.published ? 201 : 422).json({ ok: result.published, result, slug });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed";
      if (message.includes("Invalid URL")) {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      console.error("article-from-url:", error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  if (config.ownerAdminUiPath && config.ownerCliSecret) {
    app.get(config.ownerAdminUiPath, (_req, res) => {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      res.setHeader("Cache-Control", "no-store, private");
      res.type("html").send(buildOwnerArticleIngestPageHtml());
    });
  } else if (config.ownerAdminUiPath && !config.ownerCliSecret) {
    console.warn("OWNER_ADMIN_UI_PATH is set but OWNER_CLI_SECRET is missing — owner ingest HTML page is disabled.");
  }

  app.get("/health", async (_req, res) => {
    try {
      const activity = await fetchPipelineActivitySummary();
      const internalActive = shouldRunInternalPipelineTimer();
      const coalesceMs = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      res.json({
        ok: true,
        env: config.appEnv,
        llmProvider: config.llmProvider,
        internalPipelineCron: internalActive
          ? {
              active: true,
              intervalMs: Math.max(60_000, config.internalPipelineIntervalMs),
              coalesceMs,
              note:
                "In-process timer calls runPipeline while the Coolify server stays awake. Manual GET /api/cron/pipeline and POST /api/pipeline/run still work.",
            }
          : {
              active: false,
              intervalMs: null,
              coalesceMs: null,
              note: config.disableInternalPipelineCron
                ? "Internal timer disabled via DISABLE_INTERNAL_PIPELINE_CRON=true."
                : null,
            },
        pipelineActivity: activity,
        cronPingConfigured: Boolean(config.cronSecret),
        newsletterSender: {
          active: isNewsletterSenderConfigured(),
          digestHours: config.newsletterDigestHours,
          timezone: config.newsletterTimezone,
          note: isNewsletterSenderConfigured()
            ? "Sends an LLM-curated top-10 digest at each configured hour, personalized by subscriber topic preferences."
            : "Set POSTAL_API_URL, POSTAL_API_KEY, and NEWSLETTER_FROM to enable digest delivery.",
        },
        extraction: {
          readabilityEnabled: !config.disableNewsPlease,
          note: config.disableNewsPlease
            ? "DISABLE_NEWS_PLEASE=true: skipping Readability, using RSS fallback only."
            : "Mozilla Readability (JS) for full-article extraction; RSS fallback when fetch fails.",
        },
        synthesis: {
          mode: "full_feature_only",
          copyrightOverlapGramThreshold: config.copyrightOverlapGramThreshold,
          copyrightOverlapRatioThreshold: config.copyrightOverlapRatioThreshold,
          note:
            "Only LLM-generated Dispatch / Data Insight articles are published. Wire recap posts were removed. Tune COPYRIGHT_OVERLAP_* if legitimate stories fail the phrase-overlap check.",
        },
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "health failed",
      });
    }
  });

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(buildRobotsTxt());
  });

  app.get("/llms.txt", async (_req, res) => {
    try {
      const posts = await fetchRecentPosts(40);
      res.type("text/plain; charset=utf-8").send(buildLlmsTxt(posts as any));
    } catch (error) {
      console.error("llms.txt:", error);
      res.status(500).type("text/plain").send("llms.txt failed");
    }
  });

  app.get("/llms-full.txt", async (_req, res) => {
    try {
      const posts = await fetchRecentPosts(80);
      res.type("text/plain; charset=utf-8").send(buildLlmsFullTxt(posts as any));
    } catch (error) {
      console.error("llms-full.txt:", error);
      res.status(500).type("text/plain").send("llms-full.txt failed");
    }
  });

  app.get(["/feed.xml", "/rss.xml"], async (_req, res) => {
    try {
      const posts = await fetchRecentPosts(50);
      res.type("application/rss+xml; charset=utf-8").send(buildRssFeed(posts as any));
    } catch (error) {
      console.error("feed.xml:", error);
      res.status(500).type("text/plain").send("feed failed");
    }
  });

  app.get("/articles/:slug.md", async (req, res) => {
    try {
      const post = await fetchPostBySlug(req.params.slug);
      if (!post) return res.status(404).type("text/plain").send("Article not found");
      res.type("text/markdown; charset=utf-8").set("X-Robots-Tag", "all").send(buildArticleMarkdown(post as any));
    } catch (error) {
      console.error("article.md:", error);
      res.status(500).type("text/plain").send("failed");
    }
  });

  app.get("/articles/:slug.txt", async (req, res) => {
    try {
      const post = await fetchPostBySlug(req.params.slug);
      if (!post) return res.status(404).type("text/plain").send("Article not found");
      res.type("text/plain; charset=utf-8").set("X-Robots-Tag", "all").send(buildArticlePlainText(post as any));
    } catch (error) {
      console.error("article.txt:", error);
      res.status(500).type("text/plain").send("failed");
    }
  });


  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const rows = (await fetchPostSlugDatesForSitemap(2000)) as {
        slug: string;
        publishedAt: string | Date | null;
        updatedAt?: string | Date | null;
      }[];
      const base = config.appUrl.replace(/\/+$/, "");
      const staticUrls: Array<[string, string, string, string | null]> = [
        ["/", "hourly", "1.0", null],
        ["/events", "daily", "0.9", null],
        ["/digest", "daily", "0.85", null],
        ["/feed.xml", "hourly", "0.7", null],
        ["/llms.txt", "daily", "0.6", null],
        ["/llms-full.txt", "daily", "0.5", null],
        ...ALL_EDITORIAL_CATEGORIES.map((c): [string, string, string, string | null] => [
          `/category/${c.toLowerCase()}`,
          "hourly",
          "0.9",
          null,
        ]),
        ...EVERGREEN_GUIDES_SEO.map((g): [string, string, string, string | null] => [
          `/guides/${g.slug}`,
          "weekly",
          "0.75",
          g.updatedAt,
        ]),
      ];
      const staticXml = staticUrls
        .map(([locPath, freq, priority, lastmod]) => {
          const loc = `${base}${locPath === "/" ? "/" : locPath}`;
          const lm = lastmod ? `<lastmod>${escapeXml(String(lastmod).slice(0, 10))}</lastmod>` : "";
          return `  <url><loc>${escapeXml(loc)}</loc>${lm}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;
        })
        .join("\n");
      const articleUrls = rows
        .filter((r) => r.slug && String(r.slug).trim())
        .map((r) => {
          const loc = `${base}/articles/${encodeURIComponent(String(r.slug).trim())}`;
          const lastmod = sitemapLastmod(r.updatedAt ?? r.publishedAt);
          return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
        })
        .join("\n");
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticXml}
${articleUrls}
</urlset>`;
      res.type("application/xml").send(body);
    } catch (error) {
      console.error("sitemap.xml:", error);
      res.status(500).type("text/plain").send("sitemap failed");
    }
  });

  /**
   * Wake + run from UptimeRobot, Coolify scheduled tasks, GitHub Actions, etc.
   * Example: GET /api/cron/pipeline?secret=$CRON_SECRET
   */
  app.get("/api/cron/pipeline", requireOwnerOrCron, async (_req, res) => {
    try {
      const coalesce = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      const result = await runPipeline({ coalesceWithinMs: coalesce });
      const published = result.some((r) => r.published);
      res.status(published ? 201 : 202).json({ ok: true, published, result });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown pipeline failure",
      });
    }
  });

  app.post("/api/cron/newsletter", requireOwnerOrCron, async (req, res) => {
    const requestedSlot = req.query.slot;
    const slot: DigestSlot | null =
      requestedSlot === "morning" || requestedSlot === "night" ? requestedSlot : dueDigestSlot();
    if (!slot) {
      res.json({ ok: true, sent: 0, skipped: "not_due" });
      return;
    }
    try {
      const result = await buildAndSendDigest(slot);
      res.status(result.sent > 0 ? 201 : 202).json({ ok: true, slot, ...result });
    } catch (error) {
      console.error("newsletter digest:", error);
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown newsletter failure",
      });
    }
  });

  app.post("/api/pipeline/run", requireOwnerOrCron, async (_req, res) => {
    try {
      const result = await runPipeline();
      const published = result.some((run) => run.published);
      res.status(published ? 201 : 202).json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown pipeline failure",
      });
    }
  });

  app.get("/api/posts", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const searchQuery = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
      const posts = await fetchRecentPosts(limit, searchQuery);
      res.json(posts);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch posts",
      });
    }
  });

  app.get("/api/runs/:runId", requireOwner, async (req, res) => {
    try {
      const run = await fetchRun(req.params.runId);
      res.json(run);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch run",
      });
    }
  });

  app.get("/api/events", async (_req, res) => {
    try {
      const { fetchStoredEvents } = await import("./db");
      const events = await fetchStoredEvents();
      res.json(events);
    } catch (error) {
      console.error("Failed to fetch events from DB:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  function setSessionCookie(res: express.Response, token: string) {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
  }

  app.post("/api/auth/signup", rateLimit("auth-signup", 8, 10 * 60_000), async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).json({ ok: false, error: "Enter a valid email address." });
      return;
    }
    if (password.length < 8 || password.length > 200) {
      res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
      return;
    }
    try {
      const { createUser, findUserByEmail, createSession } = await import("./db");
      if (await findUserByEmail(email)) {
        res.status(409).json({ ok: false, error: "An account with that email already exists." });
        return;
      }
      const user = await createUser(email, hashPassword(password));
      const token = generateSessionToken();
      await createSession(user.id, token, new Date(Date.now() + SESSION_TTL_MS));
      setSessionCookie(res, token);
      res.status(201).json({ ok: true, email: user.email, preferences: user.preferences });
    } catch (error) {
      console.error("auth signup:", error);
      res.status(500).json({ ok: false, error: "Could not create account right now." });
    }
  });

  app.post("/api/auth/login", rateLimit("auth-login", 10, 10 * 60_000), async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    try {
      const { findUserByEmail, createSession, touchUserLogin } = await import("./db");
      const user = await findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        res.status(401).json({ ok: false, error: "Incorrect email or password." });
        return;
      }
      const token = generateSessionToken();
      await createSession(user.id, token, new Date(Date.now() + SESSION_TTL_MS));
      await touchUserLogin(user.id);
      setSessionCookie(res, token);
      res.json({ ok: true, email: user.email, preferences: user.preferences });
    } catch (error) {
      console.error("auth login:", error);
      res.status(500).json({ ok: false, error: "Could not sign in right now." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    try {
      if (token) {
        const { deleteSession } = await import("./db");
        await deleteSession(token);
      }
    } catch (error) {
      console.error("auth logout:", error);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireSession, (req, res) => {
    res.json({ email: req.sessionUser!.email, preferences: req.sessionUser!.preferences });
  });

  app.put("/api/auth/preferences", requireSession, async (req, res) => {
    const preferences: string[] = Array.from(
      new Set(
        (Array.isArray(req.body?.preferences) ? req.body.preferences : [])
          .map(normalizeNewsletterPreference)
          .filter((p): p is string => !!p && NEWSLETTER_CATEGORY_SET.has(p)),
      ),
    );
    try {
      const { updateUserPreferences } = await import("./db");
      await updateUserPreferences(req.sessionUser!.id, preferences);
      res.json({ ok: true, preferences });
    } catch (error) {
      console.error("auth preferences:", error);
      res.status(500).json({ ok: false, error: "Could not save preferences." });
    }
  });

  app.get("/api/bookmarks", requireSession, async (req, res) => {
    try {
      const { listBookmarkedPostIds } = await import("./db");
      const postIds = await listBookmarkedPostIds(req.sessionUser!.id);
      res.json(postIds);
    } catch (error) {
      console.error("bookmarks list:", error);
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  });

  app.post("/api/bookmarks/:postId", requireSession, async (req, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ ok: false, error: "Invalid post id." });
      return;
    }
    try {
      const { addBookmark } = await import("./db");
      await addBookmark(req.sessionUser!.id, postId);
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("bookmarks add:", error);
      res.status(500).json({ ok: false, error: "Could not save bookmark." });
    }
  });

  app.delete("/api/bookmarks/:postId", requireSession, async (req, res) => {
    const postId = Number(req.params.postId);
    if (!Number.isInteger(postId)) {
      res.status(400).json({ ok: false, error: "Invalid post id." });
      return;
    }
    try {
      const { removeBookmark } = await import("./db");
      await removeBookmark(req.sessionUser!.id, postId);
      res.json({ ok: true });
    } catch (error) {
      console.error("bookmarks remove:", error);
      res.status(500).json({ ok: false, error: "Could not remove bookmark." });
    }
  });

  app.post("/api/newsletter/subscribe", rateLimit("newsletter-subscribe", 5, 60_000), async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const source = typeof req.body?.source === "string" ? req.body.source.trim().slice(0, 80) : "footer";
    const preferences: string[] = Array.from(
      new Set(
        (Array.isArray(req.body?.preferences) ? req.body.preferences : [])
          .map(normalizeNewsletterPreference)
          .filter((preference): preference is string => !!preference && NEWSLETTER_CATEGORY_SET.has(preference)),
      ),
    );
    if (!EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).json({ ok: false, error: "Enter a valid email address." });
      return;
    }
    if (preferences.length === 0) {
      res.status(400).json({ ok: false, error: "Choose at least one newsletter topic." });
      return;
    }

    try {
      const { saveNewsletterSubscriber } = await import("./db");
      await saveNewsletterSubscriber(email, source || "footer", preferences);
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("newsletter subscribe:", error);
      res.status(500).json({ ok: false, error: "Could not subscribe right now." });
    }
  });

  app.get("/api/newsletter/unsubscribe", async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!/^[a-f0-9]{32,64}$/i.test(token)) {
      res.status(400).type("html").send("<h1>Invalid unsubscribe link</h1>");
      return;
    }

    try {
      const { unsubscribeNewsletter } = await import("./db");
      await unsubscribeNewsletter(token);
      res.type("html").send("<h1>You are unsubscribed</h1><p>You will no longer receive Times of SF topic emails.</p>");
    } catch (error) {
      console.error("newsletter unsubscribe:", error);
      res.status(500).type("html").send("<h1>Could not unsubscribe right now</h1>");
    }
  });

  app.post("/api/tips", rateLimit("tips-submit", 5, 10 * 60_000), async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const kind = req.body?.kind === "correction" ? "correction" : "tip";
    const postSlug = typeof req.body?.postSlug === "string" ? req.body.postSlug.trim().slice(0, 200) : null;
    const contactEmailRaw = typeof req.body?.contactEmail === "string" ? req.body.contactEmail.trim() : "";
    const contactEmail = contactEmailRaw && EMAIL_RE.test(contactEmailRaw) ? contactEmailRaw.slice(0, 254) : null;

    if (message.length < 10 || message.length > 4000) {
      res.status(400).json({ ok: false, error: "Message must be between 10 and 4000 characters." });
      return;
    }

    try {
      const { saveTip } = await import("./db");
      await saveTip({ postSlug, kind, message, contactEmail });
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("tip submit:", error);
      res.status(500).json({ ok: false, error: "Could not submit right now." });
    }
  });

  app.get("/api/tips", requireOwner, async (_req, res) => {
    try {
      const { fetchTips } = await import("./db");
      const tips = await fetchTips();
      res.json(tips);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch tips" });
    }
  });

  app.post("/api/posts/:id/expand", requireOwner, async (req, res) => {
    try {
      const { fetchPostById, updatePostContent } = await import("./db");
      const { expandContent } = await import("./agents");

      const post = await fetchPostById(req.params.id);
      if (!post) return res.status(404).json({ error: "Post not found" });

      const expanded = await expandContent(post.headline, post.body_markdown, post.entities, post.dataBlocks);
      await updatePostContent(req.params.id, expanded);

      res.json({ content: expanded });
    } catch (error) {
      console.error("Failed to expand post:", error);
      res.status(500).json({ error: "Failed to expand article" });
    }
  });

  // Persistent Kokoro TTS worker — local ONNX inference, no cloud API
  const ttsWorkerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "kokoro_worker.py");
  const ttsCacheDir = path.isAbsolute(config.ttsCacheDir)
    ? config.ttsCacheDir
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", config.ttsCacheDir);
  const END_MARKER = Buffer.from("\n---END---\n");
  const TTS_WORKER_TIMEOUT_MS = 120_000;
  let ttsWorker: import("node:child_process").ChildProcess | null = null;
  const fullAudioBuilds = new Map<string, { status: "pending" | "ready" | "failed"; error?: string }>();
  let ttsQueue: Array<{
    text: string;
    resolve: (data: Buffer) => void;
    reject: (err: Error) => void;
  }> = [];
  let ttsBusy = false;
  let ttsBuf = Buffer.alloc(0);
  let ttsTimer: NodeJS.Timeout | null = null;

  function clearTtsTimer() {
    if (ttsTimer) clearTimeout(ttsTimer);
    ttsTimer = null;
  }

  function failCurrentTts(err: Error, restartWorker = true) {
    clearTtsTimer();
    ttsBusy = false;
    const item = ttsQueue.shift();
    item?.reject(err);
    if (restartWorker && ttsWorker) {
      ttsWorker.kill();
      ttsWorker = null;
    }
    flushTtsQueue();
  }

  function spawnTtsWorker() {
    try {
      ttsBuf = Buffer.alloc(0);
      const proc = spawn("python3", [ttsWorkerScript], { stdio: ["pipe", "pipe", "pipe"] });

      proc.stdout.on("data", (chunk: Buffer) => {
        ttsBuf = Buffer.concat([ttsBuf, chunk]);
        let endIdx = ttsBuf.indexOf(END_MARKER);
        while (endIdx >= 0) {
          const response = ttsBuf.subarray(0, endIdx);
          ttsBuf = ttsBuf.subarray(endIdx + END_MARKER.length);
          clearTtsTimer();
          ttsBusy = false;
          const item = ttsQueue.shift();
          item?.resolve(response);
          flushTtsQueue();
          endIdx = ttsBuf.indexOf(END_MARKER);
        }
      });

      proc.stderr.on("data", (d: Buffer) => {
        if (d.length > 0) console.error("[tts-worker]", d.toString().trim());
      });

      proc.on("exit", (code) => {
        ttsWorker = null;
        if (ttsQueue.length > 0) {
          failCurrentTts(new Error(`TTS worker exited (${code})`), false);
        } else {
          clearTtsTimer();
          ttsBusy = false;
        }
      });

      proc.on("error", (err) => {
        ttsWorker = null;
        if (ttsQueue.length > 0) {
          failCurrentTts(err instanceof Error ? err : new Error("TTS worker failed"), false);
        } else {
          clearTtsTimer();
          ttsBusy = false;
        }
      });
      ttsWorker = proc;
    } catch {
      ttsWorker = null;
    }
  }

  function flushTtsQueue() {
    if (!ttsWorker || ttsBusy || ttsQueue.length === 0) return;
    if (ttsWorker.exitCode !== null) { spawnTtsWorker(); return; }
    ttsBusy = true;
    clearTtsTimer();
    ttsTimer = setTimeout(() => {
      failCurrentTts(new Error("TTS worker timed out"));
    }, TTS_WORKER_TIMEOUT_MS);
    try {
      ttsWorker.stdin?.write(JSON.stringify({ text: ttsQueue[0].text }) + "\n");
    } catch (err) {
      failCurrentTts(err instanceof Error ? err : new Error("Failed to write to TTS worker"));
    }
  }

  function requestTts(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!ttsWorker || ttsWorker.exitCode !== null) spawnTtsWorker();
      if (!ttsWorker) {
        reject(new Error("TTS worker is unavailable"));
        return;
      }
      ttsQueue.push({ text, resolve, reject });
      if (!ttsBusy) flushTtsQueue();
    });
  }

  function ttsCachePath(text: string): string {
    const key = crypto
      .createHash("sha256")
      .update(JSON.stringify({ provider: "kokoro", version: 1, text }))
      .digest("hex");
    return path.join(ttsCacheDir, `${key}.wav`);
  }

  function splitTtsText(raw: string, limit = 900): string[] {
    const pieces = raw
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((piece) => piece.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const piece of pieces.length ? pieces : [raw.trim()]) {
      const words = piece.length > limit ? piece.split(/\s+/).filter(Boolean) : [piece];
      for (const part of words) {
        const next = current ? `${current} ${part}` : part;
        if (next.length > limit && current) {
          chunks.push(current);
          current = part;
        } else {
          current = next;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  function fullAudioKey(slug: string, text: string): string {
    const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "article";
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ provider: "kokoro-full", version: 1, slug: safeSlug, text }))
      .digest("hex")
      .slice(0, 24);
    return `${safeSlug}-${hash}`;
  }

  function fullAudioPath(key: string): string {
    return path.join(ttsCacheDir, "articles", `${key}.wav`);
  }

  async function generateTtsWithChunkCache(text: string): Promise<Buffer> {
    const cachePath = ttsCachePath(text);
    try {
      return await fs.promises.readFile(cachePath);
    } catch (err: any) {
      if (err?.code !== "ENOENT") console.warn("[tts] cache read failed:", err);
    }

    const audio = await requestTts(text);
    try {
      await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.promises.writeFile(cachePath, audio);
    } catch (err) {
      console.warn("[tts] cache write failed:", err);
    }
    return audio;
  }

  function concatWavBuffers(buffers: Buffer[]): Buffer {
    const pcmBuffers = buffers.map((buffer) => {
      if (
        buffer.length < 44 ||
        buffer.toString("ascii", 0, 4) !== "RIFF" ||
        buffer.toString("ascii", 8, 12) !== "WAVE"
      ) {
        throw new Error("Invalid WAV audio chunk");
      }
      return buffer.subarray(44);
    });
    const pcm = Buffer.concat(pcmBuffers);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24000, 24);
    header.writeUInt32LE(24000 * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
  }

  async function buildFullArticleAudio(key: string, text: string) {
    const outputPath = fullAudioPath(key);
    try {
      fullAudioBuilds.set(key, { status: "pending" });
      const chunks = splitTtsText(text);
      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        buffers.push(await generateTtsWithChunkCache(chunk));
      }
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, concatWavBuffers(buffers));
      fullAudioBuilds.set(key, { status: "ready" });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Full audio build failed";
      fullAudioBuilds.set(key, { status: "failed", error });
      console.error("[tts] full article audio build failed:", err);
    }
  }

  app.post("/api/tts", rateLimit("tts-post", 30, 60_000), async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) { res.status(400).json({ error: "Missing text" }); return; }

    const truncated = text.length > TTS_INLINE_MAX_CHARS ? text.slice(0, TTS_INLINE_MAX_CHARS) : text;

    try {
      const audio = await requestTts(truncated);
      res.set("Content-Type", "audio/wav");
      res.send(audio);
    } catch (err) {
      console.error("[tts] error:", err);
      res.status(500).json({ error: "TTS generation failed" });
    }
  });

  app.post("/api/tts/article-audio/build", rateLimit("tts-full-build", 8, 60_000), async (req, res) => {
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!slug || !text) {
      res.status(400).json({ ok: false, error: "Missing slug or text" });
      return;
    }
    if (text.length > TTS_FULL_ARTICLE_MAX_CHARS) {
      res.status(413).json({ ok: false, error: "Article text is too large for TTS generation" });
      return;
    }

    const key = fullAudioKey(slug, text);
    const outputPath = fullAudioPath(key);

    try {
      await fs.promises.access(outputPath, fs.constants.R_OK);
      fullAudioBuilds.set(key, { status: "ready" });
      res.json({ ok: true, key, status: "ready", audioUrl: `/api/tts/article-audio/${encodeURIComponent(key)}.wav` });
      return;
    } catch {
      const current = fullAudioBuilds.get(key);
      if (!current || current.status === "failed") {
        void buildFullArticleAudio(key, text);
      }
      res.status(202).json({ ok: true, key, status: fullAudioBuilds.get(key)?.status ?? "pending" });
    }
  });

  app.get("/api/tts/article-audio/:key/status", rateLimit("tts-full-status", 120, 60_000), async (req, res) => {
    const key = req.params.key.replace(/\.wav$/i, "");
    const outputPath = fullAudioPath(key);
    try {
      await fs.promises.access(outputPath, fs.constants.R_OK);
      fullAudioBuilds.set(key, { status: "ready" });
      res.json({ ok: true, key, status: "ready", audioUrl: `/api/tts/article-audio/${encodeURIComponent(key)}.wav` });
      return;
    } catch {
      const state = fullAudioBuilds.get(key) ?? { status: "pending" as const };
      res.json({ ok: true, key, ...state });
    }
  });

  app.get("/api/tts/article-audio/:key.wav", rateLimit("tts-full-download", 60, 60_000), async (req, res) => {
    const key = req.params.key;
    const outputPath = fullAudioPath(key);
    try {
      await fs.promises.access(outputPath, fs.constants.R_OK);
      res.set("Content-Type", "audio/wav");
      res.set("Content-Disposition", `attachment; filename="${key}.wav"`);
      res.sendFile(outputPath);
    } catch {
      res.status(404).json({ ok: false, error: "Audio is not ready" });
    }
  });

  // Streaming TTS endpoint — returns audio progressively as it generates.
  // Browser <audio> starts playing as soon as the first sentence arrives (~3-5s).
  app.get("/api/tts/stream", rateLimit("tts-stream", 20, 60_000), async (req, res) => {
    const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
    if (!text) { res.status(400).json({ error: "Missing text" }); return; }

    const truncated = text.length > TTS_INLINE_MAX_CHARS ? text.slice(0, TTS_INLINE_MAX_CHARS) : text;
    const streamerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "kokoro_streamer.py");

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const proc = spawn("python3", [streamerScript, truncated], { stdio: ["pipe", "pipe", "pipe"] });

    proc.stdout.on("data", (chunk: Buffer) => {
      if (!res.destroyed) res.write(chunk);
    });

    proc.on("close", (code) => {
      if (!res.destroyed) {
        if (code !== 0 && !res.headersSent) {
          res.status(500).json({ error: "TTS generation failed" });
        } else {
          res.end();
        }
      }
    });

    proc.on("error", () => {
      if (!res.destroyed) {
        if (!res.headersSent) res.status(500).json({ error: "Failed to start TTS" });
        else res.end();
      }
    });
  });

  // Persistent chunked TTS worker — model stays warm; NDJSON PCM streams to the browser.
  const chunkedWorkerScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "scripts",
    "kokoro_chunked_worker.py",
  );
  const CHUNKED_TTS_TIMEOUT_MS = 600_000;
  let chunkedWorker: import("node:child_process").ChildProcess | null = null;
  let chunkedBusy = false;
  let chunkedBuf = Buffer.alloc(0);
  let chunkedTimer: NodeJS.Timeout | null = null;
  let chunkedQueue: Array<{
    text: string;
    res: express.Response;
  }> = [];

  function clearChunkedTimer() {
    if (chunkedTimer) clearTimeout(chunkedTimer);
    chunkedTimer = null;
  }

  function failChunkedJob(err: Error, restartWorker = true) {
    clearChunkedTimer();
    chunkedBusy = false;
    const job = chunkedQueue.shift();
    if (job && !job.res.writableEnded && !job.res.destroyed) {
      try {
        if (!job.res.headersSent) {
          job.res.status(500).json({ error: err.message });
        } else {
          job.res.write(JSON.stringify({ error: err.message }) + "\n");
          job.res.end();
        }
      } catch {
        /* ignore */
      }
    }
    if (restartWorker && chunkedWorker) {
      try { chunkedWorker.kill(); } catch { /* ignore */ }
      chunkedWorker = null;
    }
    flushChunkedQueue();
  }

  function spawnChunkedWorker() {
    try {
      chunkedBuf = Buffer.alloc(0);
      const proc = spawn("python3", ["-u", chunkedWorkerScript], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        chunkedBuf = Buffer.concat([chunkedBuf, chunk]);
        let endIdx = chunkedBuf.indexOf(END_MARKER);
        while (endIdx >= 0) {
          const payload = chunkedBuf.subarray(0, endIdx);
          chunkedBuf = chunkedBuf.subarray(endIdx + END_MARKER.length);
          clearChunkedTimer();
          chunkedBusy = false;
          const job = chunkedQueue.shift();
          if (job && !job.res.writableEnded && !job.res.destroyed) {
            try {
              if (payload.length > 0) job.res.write(payload);
              if (!job.res.writableEnded) job.res.end();
            } catch {
              /* ignore */
            }
          }
          flushChunkedQueue();
          endIdx = chunkedBuf.indexOf(END_MARKER);
        }

        // Stream partial NDJSON to the current response as soon as we have complete lines.
        if (chunkedBusy && chunkedQueue.length > 0) {
          const job = chunkedQueue[0];
          if (job && !job.res.writableEnded && !job.res.destroyed) {
            const lastNl = chunkedBuf.lastIndexOf(0x0a); // \n
            if (lastNl >= 0) {
              const ready = chunkedBuf.subarray(0, lastNl + 1);
              chunkedBuf = chunkedBuf.subarray(lastNl + 1);
              if (ready.length > 0) {
                try { job.res.write(ready); } catch { /* ignore */ }
              }
            }
          }
        }
      });

      proc.stderr.on("data", (d: Buffer) => {
        if (d.length > 0) console.error("[tts-chunked-worker]", d.toString().trim());
      });

      proc.on("exit", (code) => {
        chunkedWorker = null;
        if (chunkedQueue.length > 0) {
          failChunkedJob(new Error(`Chunked TTS worker exited (${code})`), false);
        } else {
          clearChunkedTimer();
          chunkedBusy = false;
        }
      });

      proc.on("error", (err) => {
        chunkedWorker = null;
        if (chunkedQueue.length > 0) {
          failChunkedJob(err instanceof Error ? err : new Error("Chunked TTS worker failed"), false);
        } else {
          clearChunkedTimer();
          chunkedBusy = false;
        }
      });

      chunkedWorker = proc;
      console.log("[tts-chunked-worker] spawned (model loads in background)");
    } catch (err) {
      chunkedWorker = null;
      console.error("[tts-chunked-worker] spawn failed:", err);
    }
  }

  function flushChunkedQueue() {
    if (!chunkedWorker || chunkedBusy || chunkedQueue.length === 0) return;
    if (chunkedWorker.exitCode !== null) {
      spawnChunkedWorker();
      return;
    }
    chunkedBusy = true;
    clearChunkedTimer();
    chunkedTimer = setTimeout(() => {
      failChunkedJob(new Error("Chunked TTS timed out"));
    }, CHUNKED_TTS_TIMEOUT_MS);
    try {
      chunkedWorker.stdin?.write(JSON.stringify({ text: chunkedQueue[0].text }) + "\n");
    } catch (err) {
      failChunkedJob(err instanceof Error ? err : new Error("Failed to write to chunked TTS worker"));
    }
  }

  function warmChunkedWorker() {
    if (!chunkedWorker || chunkedWorker.exitCode !== null) spawnChunkedWorker();
  }

  // Chunked TTS — NDJSON PCM for Web Audio. Prefer POST (GET query strings truncate long articles).
  const handleTtsChunked = async (req: express.Request, res: express.Response) => {
    const fromQuery = typeof req.query.text === "string" ? req.query.text.trim() : "";
    const fromBody = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const text = fromBody || fromQuery;
    if (!text) { res.status(400).json({ error: "Missing text" }); return; }
    const truncated = text.length > TTS_INLINE_MAX_CHARS ? text.slice(0, TTS_INLINE_MAX_CHARS) : text;

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    // Flush headers immediately so the browser starts reading the stream.
    if (typeof (res as express.Response & { flushHeaders?: () => void }).flushHeaders === "function") {
      (res as express.Response & { flushHeaders: () => void }).flushHeaders();
    }

    if (!chunkedWorker || chunkedWorker.exitCode !== null) spawnChunkedWorker();
    if (!chunkedWorker) {
      // Fallback: one-shot script (cold — slower).
      const chunkedScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "kokoro_chunked.py");
      const proc = spawn("python3", ["-u", chunkedScript], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      proc.stdin.write(truncated);
      proc.stdin.end();
      proc.stdout.pipe(res);
      proc.on("error", () => {
        if (!res.headersSent) res.status(500).json({ error: "Failed to start TTS" });
      });
      return;
    }

    chunkedQueue.push({ text: truncated, res });
    res.on("close", () => {
      // If client disconnects before we start, drop the queued job.
      if (!chunkedBusy) {
        chunkedQueue = chunkedQueue.filter((j) => j.res !== res);
      }
    });
    if (!chunkedBusy) flushChunkedQueue();
  };

  app.get("/api/tts/chunked", rateLimit("tts-chunked", 20, 60_000), handleTtsChunked);
  app.post("/api/tts/chunked", rateLimit("tts-chunked", 20, 60_000), handleTtsChunked);

  if (isProduction()) {
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
    const indexHtml = path.join(distDir, "index.html");
    if (fs.existsSync(indexHtml)) {
      const readIndex = () => fs.promises.readFile(indexHtml, "utf8");

      const sendListPage = async (res: express.Response, page: ListPageKind, category?: string) => {
        try {
          const items = await fetchPostsForSeoList({ category, limit: 24 });
          const html = injectListPageMetadata(await readIndex(), page, items);
          res.type("html").send(html);
        } catch (error) {
          console.error("list page html:", error);
          res.sendFile(indexHtml);
        }
      };

      app.get("/", async (req, res) => {
        const deepLinkTarget = req.query.articleId ?? req.query.id;
        if (deepLinkTarget) {
          try {
            const post = await resolveLegacyArticleTarget(deepLinkTarget);
            if (!post) {
              res.sendFile(indexHtml);
              return;
            }
            const html = injectArticleMetadata(await readIndex(), post);
            res.type("html").send(html);
          } catch (error) {
            console.error("legacy article html:", error);
            res.sendFile(indexHtml);
          }
          return;
        }
        await sendListPage(res, { kind: "home" });
      });

      app.get("/category/:slug", async (req, res) => {
        const category = resolveCategoryFromSlug(req.params.slug);
        if (!category) {
          res.sendFile(indexHtml);
          return;
        }
        await sendListPage(res, { kind: "category", category }, category);
      });

      app.get("/events", async (_req, res) => {
        await sendListPage(res, { kind: "events" });
      });

      app.get("/digest", async (_req, res) => {
        await sendListPage(res, { kind: "digest" });
      });

      app.get("/guides/:slug", async (req, res) => {
        const guide = EVERGREEN_GUIDES_SEO.find((g) => g.slug === req.params.slug.toLowerCase());
        if (!guide) {
          res.sendFile(indexHtml);
          return;
        }
        await sendListPage(res, {
          kind: "guide",
          slug: guide.slug,
          title: guide.title,
          description: guide.description,
          updatedAt: guide.updatedAt,
        });
      });

      app.get("/articles/:slug", async (req, res) => {
        try {
          let slugParam = req.params.slug;
          let format: "html" | "md" | "txt" = "html";
          if (slugParam.endsWith(".md")) {
            format = "md";
            slugParam = slugParam.slice(0, -3);
          } else if (slugParam.endsWith(".txt")) {
            format = "txt";
            slugParam = slugParam.slice(0, -4);
          }

          const post = await fetchPostBySlug(slugParam);
          if (!post) {
            if (format === "html") res.sendFile(indexHtml);
            else res.status(404).type("text/plain").send("Article not found");
            return;
          }

          if (format === "md") {
            res
              .type("text/markdown; charset=utf-8")
              .set("X-Robots-Tag", "all")
              .send(buildArticleMarkdown(post as any));
            return;
          }
          if (format === "txt") {
            res
              .type("text/plain; charset=utf-8")
              .set("X-Robots-Tag", "all")
              .send(buildArticlePlainText(post as any));
            return;
          }

          const html = injectArticleMetadata(await readIndex(), post);
          res.type("html").send(html);
        } catch (error) {
          console.error("article html:", error);
          res.sendFile(indexHtml);
        }
      });

      app.use(express.static(distDir));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          next();
          return;
        }
        res.sendFile(indexHtml);
      });
    }
  }

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
    // Preload Kokoro so the first Listen click streams audio within seconds.
    try {
      warmChunkedWorker();
    } catch (err) {
      console.warn("[tts-chunked-worker] prewarm skipped:", err);
    }
    if (config.ownerAdminUiPath && config.ownerCliSecret) {
      console.log(`Owner article ingest UI: GET ${config.ownerAdminUiPath} (same origin as this server)`);
    }
    if (shouldRunInternalPipelineTimer()) {
      const ms = Math.max(60_000, config.internalPipelineIntervalMs);
      const coalesce = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      console.log(
        `Internal pipeline scheduler: every ${ms / 1000}s; coalesce=${coalesce ? `${coalesce / 1000}s` : "off"}.`,
      );
      const tick = () =>
        runPipeline({ coalesceWithinMs: coalesce }).catch((err) =>
          console.error("Internal pipeline tick failed:", err),
        );
      setInterval(tick, ms);
      setTimeout(tick, 30_000);
    }
    if (shouldRunNewsletterTimer()) {
      console.log(
        `Newsletter digest scheduler: hours=${config.newsletterDigestHours.join(",")} tz=${config.newsletterTimezone} (checked every 60s).`,
      );
      const tick = () => {
        const slot = dueDigestSlot();
        if (!slot) return;
        buildAndSendDigest(slot)
          .then((result) => {
            if (result.sent > 0) console.log(`Newsletter ${slot} digest delivered to ${result.sent} subscriber(s).`);
          })
          .catch((err) => console.error("Newsletter digest failed:", err));
      };
      setInterval(tick, 60_000);
      setTimeout(tick, 60_000);
    } else {
      console.log("Newsletter sender disabled: set POSTAL_API_URL, POSTAL_API_KEY, and NEWSLETTER_FROM to enable delivery.");
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
