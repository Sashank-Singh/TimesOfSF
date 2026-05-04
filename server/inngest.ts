import { Inngest } from "inngest";
import { serve } from "inngest/express";
import { config } from "./config";
import { runPipeline } from "./pipeline";

export const inngest = new Inngest({
  id: "times-of-sf-news-pipeline",
  eventKey: config.inngestEventKey,
});

export const scheduledNewsPipeline = inngest.createFunction(
  {
    id: "scheduled-news-pipeline",
    name: "Scheduled News Pipeline",
  },
  {
    cron: config.pipelineCron,
  },
  async ({ step }) => {
    return step.run("run-news-pipeline", async () => runPipeline());
  },
);

export const manualNewsPipeline = inngest.createFunction(
  {
    id: "manual-news-pipeline",
    name: "Manual News Pipeline",
  },
  { event: "news.pipeline.run" },
  async ({ step }) => {
    return step.run("run-news-pipeline", async () => runPipeline());
  },
);

export const inngestHandler = serve({
  client: inngest,
  functions: [scheduledNewsPipeline, manualNewsPipeline],
});
