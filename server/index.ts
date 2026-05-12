import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOwnerArticleIngestPageHtml } from "./ownerAdminHtml";
import { config, isProduction } from "./config";
import { ensureSchema, fetchPipelineActivitySummary, fetchRecentPosts, fetchRun } from "./db";
import { loadInngestState } from "./inngest";
import { getPipelineCronHealth } from "./pipelineSchedule";
import { runPipeline } from "./pipeline";

function shouldRunInternalPipelineTimer(inngestEnabled: boolean): boolean {
  if (config.disableInternalPipelineCron) return false;
  if (inngestEnabled && !config.allowInternalCronWithInngest) return false;
  return true;
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
          newsPleaseEnabled: !config.disableNewsPlease,
          note: config.disableNewsPlease
            ? "DISABLE_NEWS_PLEASE=true: skipping Python extractor (typical in slim containers)."
            : "Uses Python news-please when available; otherwise falls back to RSS headline/summary metadata.",
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

  if (isProduction()) {
    const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
    const indexHtml = path.join(distDir, "index.html");
    if (fs.existsSync(indexHtml)) {
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
