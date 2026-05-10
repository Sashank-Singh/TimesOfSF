import type { RequestHandler } from "express";
import { config } from "./config";
import { runPipeline } from "./pipeline";

type InngestClient = {
  send: (payload: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
};

type StepTools = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

type InngestModuleState = {
  enabled: boolean;
  reason?: string;
  inngest?: InngestClient;
  handler?: RequestHandler;
};

let cachedState: InngestModuleState | null = null;

export async function loadInngestState(): Promise<InngestModuleState> {
  if (cachedState) return cachedState;

  if (!config.inngestEventKey || !config.inngestSigningKey) {
    console.warn(
      "⚠️ INNGEST NOT ENABLED: Missing INNGEST_EVENT_KEY or INNGEST_SIGNING_KEY. Scheduled jobs from Inngest will not run; the API server falls back to its internal timer when it starts (see /health → internalPipelineCron).",
    );
    cachedState = {
      enabled: false,
      reason:
        "Inngest env vars are not configured. The server uses an internal interval scheduler unless DISABLE_INTERNAL_PIPELINE_CRON=true.",
    };
    return cachedState;
  }

  console.log("🚀 INITIALIZING INNGEST: Automation mode active.");

  try {
    const [{ Inngest }, { serve }] = await Promise.all([import("inngest"), import("inngest/express")]);

    const inngest = new Inngest({
      id: "times-of-sf-news-pipeline",
      eventKey: config.inngestEventKey,
    });

    const scheduledNewsPipeline = inngest.createFunction(
      {
        id: "scheduled-news-pipeline",
        name: "Scheduled News Pipeline",
      },
      {
        cron: config.pipelineCron,
      },
      async ({ step }: { step: StepTools }) => {
        return step.run("run-news-pipeline", async () => runPipeline());
      },
    );

    const manualNewsPipeline = inngest.createFunction(
      {
        id: "manual-news-pipeline",
        name: "Manual News Pipeline",
      },
      { event: "news.pipeline.run" },
      async ({ step }: { step: StepTools }) => {
        return step.run("run-news-pipeline", async () => runPipeline());
      },
    );

    const handler = serve({
      client: inngest,
      functions: [scheduledNewsPipeline, manualNewsPipeline],
    });

    cachedState = {
      enabled: true,
      inngest,
      handler,
    };
    return cachedState;
  } catch (error) {
    cachedState = {
      enabled: false,
      reason: error instanceof Error ? error.message : "Failed to load Inngest runtime.",
    };
    return cachedState;
  }
}
