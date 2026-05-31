import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
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
import { runPipeline } from "./pipeline";

function shouldRunInternalPipelineTimer(): boolean {
  if (config.disableInternalPipelineCron) return false;
  return true;
}

const TTS_INLINE_MAX_CHARS = 8_000;
const TTS_FULL_ARTICLE_MAX_CHARS = 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

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

  const app = express();
  let corsOrigins = config.corsAllowedOrigins;
  if (corsOrigins.length === 0 && isProduction()) {
    try {
      corsOrigins = [new URL(config.appUrl).origin];
    } catch {
      corsOrigins = [];
    }
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
            methods: ["GET", "HEAD", "POST", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
            maxAge: 86_400,
          }
        : { origin: true },
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
      const posts = await fetchRecentPosts(limit);
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

  app.post("/api/newsletter/subscribe", rateLimit("newsletter-subscribe", 5, 60_000), async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const source = typeof req.body?.source === "string" ? req.body.source.trim().slice(0, 80) : "footer";
    if (!EMAIL_RE.test(email) || email.length > 254) {
      res.status(400).json({ ok: false, error: "Enter a valid email address." });
      return;
    }

    try {
      const { saveNewsletterSubscriber } = await import("./db");
      await saveNewsletterSubscriber(email, source || "footer");
      res.status(201).json({ ok: true });
    } catch (error) {
      console.error("newsletter subscribe:", error);
      res.status(500).json({ ok: false, error: "Could not subscribe right now." });
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

  // Chunked TTS endpoint — per-sentence PCM chunks as NDJSON, for Web Audio API.
  // Each line is JSON: {"pcm": "<base64>"} — first line has {"sampleRate": 24000}.
  app.get("/api/tts/chunked", rateLimit("tts-chunked", 20, 60_000), async (req, res) => {
    const text = typeof req.query.text === "string" ? req.query.text.trim() : "";
    if (!text) { res.status(400).json({ error: "Missing text" }); return; }
    const truncated = text.length > TTS_INLINE_MAX_CHARS ? text.slice(0, TTS_INLINE_MAX_CHARS) : text;

    const chunkedScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "kokoro_chunked.py");

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    const proc = spawn("python3", [chunkedScript], { stdio: ["pipe", "pipe", "pipe"] });

    proc.stdin.write(truncated);
    proc.stdin.end();

    // Pipe stdout → response with proper backpressure.
    // DO NOT kill on req close — pipe() manages stream lifecycle, and
    // req.on("close") fires too early on proxy-kept-alive GET connections.
    proc.stdout.pipe(res);

    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    // Safety timer — kill orphaned process after 10 minutes
    const killTimer = setTimeout(() => { proc.kill(); }, 600_000);
    proc.on("exit", () => clearTimeout(killTimer));

    // If pipe already ended res, skip extra end
    const maybeEnd = () => { if (!res.writableEnded) res.end(); };

    proc.on("close", (code) => {
      clearTimeout(killTimer);
      if (res.writableEnded || res.destroyed) return;
      if (code !== 0) {
        const msg = stderr.trim() || `exit ${code}`;
        console.error("[tts-chunked] error:", msg);
        if (!res.headersSent) res.status(500).json({ error: `TTS error: ${msg}` });
        else maybeEnd();
      } else {
        maybeEnd();
      }
    });

    proc.on("error", (err) => {
      clearTimeout(killTimer);
      console.error("[tts-chunked] spawn error:", err);
      if (!res.headersSent && !res.destroyed) {
        res.status(500).json({ error: "Failed to start TTS" });
      }
    });
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
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
