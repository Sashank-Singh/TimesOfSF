import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOwnerArticleIngestPageHtml } from "./ownerAdminHtml";
import { config, isProduction } from "./config";
import {
  ensureSchema,
  fetchPipelineActivitySummary,
  fetchPostById,
  fetchPostBySlug,
  fetchPostSlugDatesForSitemap,
  fetchRecentPosts,
  fetchRun,
} from "./db";
import { loadInngestState } from "./inngest";
import { getPipelineCronHealth } from "./pipelineSchedule";
import { runPipeline } from "./pipeline";

function shouldRunInternalPipelineTimer(inngestEnabled: boolean): boolean {
  if (config.disableInternalPipelineCron) return false;
  if (inngestEnabled && !config.allowInternalCronWithInngest) return false;
  return true;
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
    : absolutePublicUrl("/favicon.svg");
  const published = post.created_at instanceof Date
    ? post.created_at.toISOString()
    : typeof post.created_at === "string"
      ? post.created_at
      : new Date().toISOString();

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: post.headline,
    description,
    datePublished: published,
    dateModified: published,
    url,
    image: [image],
    author: { "@type": "Organization", name: "Times of SF" },
    publisher: {
      "@type": "Organization",
      name: "Times of San Francisco",
      logo: {
        "@type": "ImageObject",
        url: absolutePublicUrl("/favicon.svg"),
      },
    },
    mainEntityOfPage: url,
  }).replace(/</g, "\\u003c");

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="Times of San Francisco" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join("\n    ");
}

function injectArticleMetadata(indexHtml: string, post: any): string {
  const articleTags = buildArticleHeadTags(post);
  let html = indexHtml;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, "");
  html = html.replace(/<meta\s+name="description"[\s\S]*?>/i, "");
  html = html.replace(/<link\s+rel="canonical"[\s\S]*?>/i, "");
  html = html.replace(/<meta\s+property="og:[^"]+"[\s\S]*?>/gi, "");
  html = html.replace(/<meta\s+name="twitter:[^"]+"[\s\S]*?>/gi, "");
  return html.replace("</head>", `    ${articleTags}\n  </head>`);
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
  const inngestState = await loadInngestState();

  const app = express();
  const corsOrigins = config.corsAllowedOrigins;
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
            methods: ["GET", "HEAD", "POST", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
            maxAge: 86_400,
          }
        : { origin: true },
    ),
  );
  app.use(express.json());

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
      const internalActive = shouldRunInternalPipelineTimer(inngestState.enabled);
      const coalesceMs = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      const cronHealth = inngestState.enabled ? getPipelineCronHealth(config.pipelineCron) : null;
      res.json({
        ok: true,
        env: config.appEnv,
        llmProvider: config.llmProvider,
        inngestEnabled: inngestState.enabled,
        inngestReason: inngestState.reason ?? null,
        inngestSchedule: inngestState.enabled
          ? cronHealth
            ? { enabled: true, ...cronHealth }
            : {
                enabled: true,
                pipelineCron: config.pipelineCron,
                timezone: "UTC" as const,
                nextPipelineRunAt: null,
                msUntilNextPipelineRun: null,
                humanApproxWait: null,
                parseNote: `Unsupported cron shape for countdown; got "${config.pipelineCron}". Supported: */N * * * * and 0 * * * * (UTC).`,
              }
          : {
              enabled: false,
              pipelineCron: config.pipelineCron,
              timezone: "UTC" as const,
              nextPipelineRunAt: null,
              msUntilNextPipelineRun: null,
              humanApproxWait: null,
              note:
                "Inngest is off—no scheduled Inngest countdown. Use internalPipelineCron, GET /api/cron/pipeline, or POST /api/pipeline/run.",
            },
        allowInternalCronWithInngest: config.allowInternalCronWithInngest,
        internalPipelineCron: internalActive
          ? {
              active: true,
              intervalMs: Math.max(60_000, config.internalPipelineIntervalMs),
              coalesceMs,
              note:
                "In-process timer calls runPipeline while the server stays awake. When Inngest is enabled, this timer is OFF by default so scheduling is not duplicated—use Inngest cron + /api/inngest. Set ALLOW_INTERNAL_CRON_WITH_INNGEST=true only if you intentionally want both. Manual GET /api/cron/pipeline and POST /api/pipeline/run still work.",
            }
          : {
              active: false,
              intervalMs: null,
              coalesceMs: null,
              note: inngestState.enabled
                ? "Internal timer skipped because Inngest is enabled (single scheduler). Set ALLOW_INTERNAL_CRON_WITH_INNGEST=true to re-enable both."
                : config.disableInternalPipelineCron
                  ? "Internal timer disabled via DISABLE_INTERNAL_PIPELINE_CRON=true."
                  : null,
            },
        pipelineActivity: activity,
        cronPingConfigured: Boolean(config.cronSecret),
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
    const base = config.appUrl.replace(/\/+$/, "");
    res
      .type("text/plain")
      .send(
        [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "",
          `Sitemap: ${base}/sitemap.xml`,
          "",
        ].join("\n"),
      );
  });

  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const rows = (await fetchPostSlugDatesForSitemap(2000)) as {
        slug: string;
        publishedAt: string | Date | null;
      }[];
      const base = config.appUrl.replace(/\/+$/, "");
      const home = `  <url><loc>${escapeXml(`${base}/`)}</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`;
      const articleUrls = rows
        .filter((r) => r.slug && String(r.slug).trim())
        .map((r) => {
          const loc = `${base}/articles/${encodeURIComponent(String(r.slug).trim())}`;
          const lastmod = sitemapLastmod(r.publishedAt);
          return `  <url><loc>${escapeXml(loc)}</loc><lastmod>${escapeXml(lastmod)}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
        })
        .join("\n");
      const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${home}
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
  app.get("/api/cron/pipeline", async (req, res) => {
    if (!config.cronSecret || req.query.secret !== config.cronSecret) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
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

  app.all("/api/pipeline/run", async (_req, res) => {
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

  app.post("/api/pipeline/trigger", async (_req, res) => {
    if (!inngestState.enabled || !inngestState.inngest) {
      res.status(503).json({
        error: inngestState.reason ?? "Inngest is not available in this runtime.",
      });
      return;
    }

    try {
      const event = await inngestState.inngest.send({
        name: "news.pipeline.run",
        data: {},
      });
      res.status(202).json({ ok: true, event });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to enqueue pipeline run",
      });
    }
  });

  app.get("/api/posts", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const posts = await fetchRecentPosts(limit);
      res.json(posts);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to fetch posts",
      });
    }
  });

  app.get("/api/runs/:runId", async (req, res) => {
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

  app.post("/api/posts/:id/expand", async (req, res) => {
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

  if (inngestState.enabled && inngestState.handler) {
    app.use("/api/inngest", inngestState.handler);
  }

  // Server-side TTS via edge-tts (Python subprocess)
  app.post("/api/tts", async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const voice = typeof req.body?.voice === "string" ? req.body.voice.trim() : "en-US-JennyNeural";
    if (!text) { res.status(400).json({ error: "Missing text" }); return; }

    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const pythonArgs = [
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "tts.py"),
      JSON.stringify({ text: truncated, voice }),
    ];

    try {
      const python = await import("node:child_process");
      const proc = python.spawn("python3", pythonArgs, { timeout: 120_000 });
      const chunks: Buffer[] = [];

      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => {
        if (d.length > 0) console.error("[tts stderr]", d.toString().trim());
      });

      await new Promise<void>((resolve, reject) => {
        proc.on("close", (code: number | null) => {
          if (code === 0 && chunks.length > 0) resolve();
          else reject(new Error(`TTS process exited ${code} (${chunks.length} chunks)`));
        });
        proc.on("error", reject);
      });

      res.set("Content-Type", "audio/mpeg");
      res.set("X-TTS-Voice", voice);
      res.send(Buffer.concat(chunks));
    } catch (err) {
      console.error("TTS failed:", err);
      res.status(500).json({ error: "TTS generation failed", detail: err instanceof Error ? err.message : String(err) });
    }
  });

  if (isProduction()) {
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
    const indexHtml = path.join(distDir, "index.html");
    if (fs.existsSync(indexHtml)) {
      app.get("/", async (req, res, next) => {
        const deepLinkTarget = req.query.articleId ?? req.query.id;
        if (!deepLinkTarget) {
          next();
          return;
        }

        try {
          const post = await resolveLegacyArticleTarget(deepLinkTarget);
          if (!post) {
            res.sendFile(indexHtml);
            return;
          }

          const html = injectArticleMetadata(await fs.promises.readFile(indexHtml, "utf8"), post);
          res.type("html").send(html);
        } catch (error) {
          console.error("legacy article html:", error);
          res.sendFile(indexHtml);
        }
      });

      app.get("/articles/:slug", async (req, res) => {
        try {
          const post = await fetchPostBySlug(req.params.slug);
          if (!post) {
            res.sendFile(indexHtml);
            return;
          }

          const html = injectArticleMetadata(await fs.promises.readFile(indexHtml, "utf8"), post);
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
    if (config.ownerAdminUiPath && config.ownerCliSecret) {
      console.log(`Owner article ingest UI: GET ${config.ownerAdminUiPath} (same origin as this server)`);
    }
    if (!inngestState.enabled && inngestState.reason) {
      console.log(`Inngest inactive: ${inngestState.reason}`);
    }
    if (shouldRunInternalPipelineTimer(inngestState.enabled)) {
      const ms = Math.max(60_000, config.internalPipelineIntervalMs);
      const coalesce = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      console.log(
        `Internal pipeline scheduler: every ${ms / 1000}s; coalesce=${coalesce ? `${coalesce / 1000}s` : "off"}; inngestEnabled=${inngestState.enabled} allowInternalCronWithInngest=${config.allowInternalCronWithInngest}.`,
      );
      const tick = () =>
        runPipeline({ coalesceWithinMs: coalesce }).catch((err) =>
          console.error("Internal pipeline tick failed:", err),
        );
      setInterval(tick, ms);
      setTimeout(tick, 30_000);
    } else if (inngestState.enabled) {
      console.log(
        "Internal pipeline timer skipped: Inngest is the active scheduler (set ALLOW_INTERNAL_CRON_WITH_INNGEST=true to run both).",
      );
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
