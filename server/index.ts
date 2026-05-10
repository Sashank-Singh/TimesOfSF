import express from "express";
import cors from "cors";
import { config } from "./config";
import { ensureSchema, fetchPipelineActivitySummary, fetchRecentPosts, fetchRun } from "./db";
import { loadInngestState } from "./inngest";
import { runPipeline } from "./pipeline";

async function start() {
  await ensureSchema();
  const inngestState = await loadInngestState();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    try {
      const activity = await fetchPipelineActivitySummary();
      const internalActive = !config.disableInternalPipelineCron;
      const coalesceMs = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      res.json({
        ok: true,
        env: config.appEnv,
        llmProvider: config.llmProvider,
        inngestEnabled: inngestState.enabled,
        inngestReason: inngestState.reason ?? null,
        internalPipelineCron: internalActive
          ? {
              active: true,
              intervalMs: Math.max(60_000, config.internalPipelineIntervalMs),
              coalesceMs,
              note:
                "This timer calls runPipeline on an interval while the process is awake—it does not create an Inngest dashboard entry. Inngest cron (if configured) invokes the same code path separately. Set DISABLE_INTERNAL_PIPELINE_CRON=true to rely only on Inngest + manual/cron HTTP triggers. On Render Free, instances spin down—use GET /api/cron/pipeline with CRON_SECRET or upgrade the instance.",
            }
          : { active: false, intervalMs: null, coalesceMs: null },
        pipelineActivity: activity,
        cronPingConfigured: Boolean(config.cronSecret),
        extraction: {
          newsPleaseEnabled: !config.disableNewsPlease,
          note: config.disableNewsPlease
            ? "DISABLE_NEWS_PLEASE=true: skipping Python extractor (use on Render without news-please)."
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
   * Wake + run from UptimeRobot, Render Cron Jobs, GitHub Actions, etc.
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

  app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${config.port}`);
    if (!inngestState.enabled && inngestState.reason) {
      console.log(`Inngest inactive: ${inngestState.reason}`);
    }
    if (!config.disableInternalPipelineCron) {
      const ms = Math.max(60_000, config.internalPipelineIntervalMs);
      const coalesce = config.pipelineCoalesceMs > 0 ? config.pipelineCoalesceMs : null;
      console.log(
        `Internal pipeline scheduler: every ${ms / 1000}s; coalesce=${coalesce ? `${coalesce / 1000}s` : "off"}; inngestEnabled=${inngestState.enabled} (timer runs inside this process—not an Inngest UI event; disable with DISABLE_INTERNAL_PIPELINE_CRON=true).`,
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
