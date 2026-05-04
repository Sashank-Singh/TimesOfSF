import express from "express";
import { config } from "./config";
import { ensureSchema, fetchRecentPosts, fetchRun } from "./db";
import { inngest, inngestHandler } from "./inngest";
import { runPipeline } from "./pipeline";

async function start() {
  await ensureSchema();

  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, env: config.appEnv });
  });

  app.post("/api/pipeline/run", async (_req, res) => {
    try {
      const result = await runPipeline();
      res.status(result.published ? 201 : 202).json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown pipeline failure",
      });
    }
  });

  app.post("/api/pipeline/trigger", async (_req, res) => {
    try {
      const event = await inngest.send({
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

  app.get("/api/posts", async (_req, res) => {
    try {
      const posts = await fetchRecentPosts();
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

  app.use("/api/inngest", inngestHandler);

  app.listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
