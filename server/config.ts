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

function readOptionalFloat(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const llmProvider = readOptionalProvider();

const port = readOptionalInt("PORT", 8787);

/** Public base URL: set APP_URL explicitly, or use Coolify's COOLIFY_URL / COOLIFY_FQDN (first if comma-separated). */
function readPublicAppUrl(forPort: number) {
  const explicit = (process.env.APP_URL ?? process.env.COOLIFY_URL)?.split(",")[0]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const fqdn = process.env.COOLIFY_FQDN?.split(",")[0]?.trim();
  if (fqdn) {
    const u =
      fqdn.startsWith("http://") || fqdn.startsWith("https://") ? fqdn : `https://${fqdn}`;
    return u.replace(/\/+$/, "");
  }
  return `http://localhost:${forPort}`;
}

export const config = {
  appEnv: process.env.NODE_ENV ?? "development",
  port,
  appUrl: readPublicAppUrl(port),
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
  /** When Inngest is disabled, still tick the pipeline on this interval (external cron substitute). */
  internalPipelineIntervalMs: readOptionalInt("INTERNAL_PIPELINE_INTERVAL_MS", 10 * 60 * 1000),
  disableInternalPipelineCron: process.env.DISABLE_INTERNAL_PIPELINE_CRON === "true",
  /**
   * When Inngest is enabled, the in-process `setInterval` pipeline timer is OFF by default so only Inngest cron + manual triggers run `runPipeline`.
   * Set ALLOW_INTERNAL_CRON_WITH_INNGEST=true to run both (can double-fire; not recommended).
   */
  allowInternalCronWithInngest: process.env.ALLOW_INTERNAL_CRON_WITH_INNGEST === "true",
  /**
   * Internal timer + /api/cron/pipeline skip starting work if a pipeline row was created within this window.
   * Prevents duplicate overlapping runs when both Inngest and the internal timer fire. HTTP /api/pipeline/run ignores this.
   */
  pipelineCoalesceMs: readOptionalInt("PIPELINE_COALESCE_MS", 7 * 60 * 1000),
  /** Optional shared secret for GET /api/cron/pipeline?secret=… (UptimeRobot / Coolify scheduled tasks / GitHub Actions). */
  cronSecret: process.env.CRON_SECRET,
  minSuccessfulSources: readOptionalInt("MIN_SUCCESSFUL_SOURCES", 2),
  sourceTimeoutMs: readOptionalInt("SOURCE_TIMEOUT_MS", 15000),
  trendLimit: readOptionalInt("TREND_LIMIT", 20),
  serperApiKey: process.env.SERPER_API_KEY,
  /**
   * Skip Python news-please extraction (RSS/HTML fallback only). Use on hosts without a working venv/Python (common in minimal containers).
   */
  disableNewsPlease: process.env.DISABLE_NEWS_PLEASE === "true",
  /** Primary synthesis: min overlapping 8-word n-grams vs any source excerpt before rejecting as too close. Default 7 (was 4). */
  copyrightOverlapGramThreshold: readOptionalInt("COPYRIGHT_OVERLAP_GRAM_THRESHOLD", 7),
  /** Primary synthesis: overlap count / min(set sizes) threshold. Default 0.12 (was 0.08). */
  copyrightOverlapRatioThreshold: readOptionalFloat("COPYRIGHT_OVERLAP_RATIO_THRESHOLD", 0.12),
};

export function isProduction() {
  return config.appEnv === "production";
}
