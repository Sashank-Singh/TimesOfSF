import dotenv from "dotenv";

dotenv.config();

type LlmProvider = "gemini" | "fireworks";

function readEnv(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
 
function readOptionalInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalProvider(): LlmProvider {
  const raw = process.env.LLM_PROVIDER?.toLowerCase();
  if (raw === "gemini") return "gemini";
  return "fireworks";
}

function readProviderApiKey(provider: LlmProvider) {
  if (provider === "fireworks") {
    return readEnv("FIREWORKS_API_KEY");
  }
  return readEnv("GEMINI_API_KEY");
}

const llmProvider = readOptionalProvider();

export const config = {
  appEnv: process.env.NODE_ENV ?? "development",
  port: readOptionalInt("PORT", 8787),
  appUrl: process.env.RENDER_EXTERNAL_URL ?? process.env.APP_URL ?? "http://localhost:8787",
  llmProvider,
  llmApiKey: readProviderApiKey(llmProvider),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  fireworksBaseUrl: process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1",
  fireworksModel: process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/llama-v3p1-8b-instruct",
  databaseUrl: readEnv("DATABASE_URL"),
  inngestEventKey: process.env.INNGEST_EVENT_KEY,
  inngestSigningKey: process.env.INNGEST_SIGNING_KEY,
  pipelineCron: process.env.PIPELINE_CRON ?? "*/10 * * * *",
  /** When Inngest is disabled, still tick the pipeline on this interval (Render cron substitute). */
  internalPipelineIntervalMs: readOptionalInt("INTERNAL_PIPELINE_INTERVAL_MS", 10 * 60 * 1000),
  disableInternalPipelineCron: process.env.DISABLE_INTERNAL_PIPELINE_CRON === "true",
  /**
   * Internal timer + /api/cron/pipeline skip starting work if a pipeline row was created within this window.
   * Prevents duplicate overlapping runs when both Inngest and the internal timer fire. HTTP /api/pipeline/run ignores this.
   */
  pipelineCoalesceMs: readOptionalInt("PIPELINE_COALESCE_MS", 7 * 60 * 1000),
  /** Optional shared secret for GET /api/cron/pipeline?secret=… (UptimeRobot / Render cron / GitHub Actions). */
  cronSecret: process.env.CRON_SECRET,
  minSuccessfulSources: readOptionalInt("MIN_SUCCESSFUL_SOURCES", 2),
  sourceTimeoutMs: readOptionalInt("SOURCE_TIMEOUT_MS", 15000),
  trendLimit: readOptionalInt("TREND_LIMIT", 20),
  serperApiKey: process.env.SERPER_API_KEY,
};

export function isProduction() {
  return config.appEnv === "production";
}
