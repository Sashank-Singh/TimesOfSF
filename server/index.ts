import express from "express";
import cors from "cors";
import { config } from "./config";
import { ensureSchema, fetchRecentPosts, fetchRun } from "./db";
import { loadInngestState } from "./inngest";
import { runPipeline } from "./pipeline";

async function start() {
  await ensureSchema();
  const inngestState = await loadInngestState();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    const internalActive = !inngestState.enabled && !config.disableInternalPipelineCron;
    res.json({
      ok: true,
      env: config.appEnv,
      llmProvider: config.llmProvider,
      inngestEnabled: inngestState.enabled,
      inngestReason: inngestState.reason ?? null,
      internalPipelineCron: internalActive
        ? { active: true, intervalMs: Math.max(60_000, config.internalPipelineIntervalMs) }
        : { active: false, intervalMs: null },
    });
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

  app.get("/api/events", async (req, res) => {
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
      console.log(`Inngest disabled: ${inngestState.reason}`);
    }
    if (!inngestState.enabled && !config.disableInternalPipelineCron) {
      const ms = Math.max(60_000, config.internalPipelineIntervalMs);
      console.log(
        `Internal pipeline scheduler: every ${ms / 1000}s. Configure Inngest keys on Render to use managed cron instead.`,
      );
      setInterval(() => {
        runPipeline().catch((err) => console.error("Internal pipeline tick failed:", err));
      }, ms);
      setTimeout(() => {
        runPipeline().catch((err) => console.error("Initial pipeline warm-up failed:", err));
      }, 30_000);
    }
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
