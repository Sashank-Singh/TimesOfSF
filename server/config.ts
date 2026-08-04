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
  const raw = process.env.LLM_PROVIDER?.toLowerCase().trim();
  if (raw === "gemini") return "gemini";
  if (raw === "fireworks") return "fireworks";

  const hasFw = Boolean(process.env.FIREWORKS_API_KEY?.trim());
  const hasGem = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (hasFw && !hasGem) return "fireworks";
  if (hasGem && !hasFw) return "gemini";
  if (hasFw && hasGem) return "fireworks";

  throw new Error(
    "Configure the LLM: set FIREWORKS_API_KEY and/or GEMINI_API_KEY, or set LLM_PROVIDER=gemini|fireworks with the matching key.",
  );
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

function readDigestHours(name: string, fallback: number[]): number[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const hours = raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  return hours.length > 0 ? hours : fallback;
}

const llmProvider = readOptionalProvider();

const port = readOptionalInt("PORT", 8787);

function readOwnerAdminUiPath(): string | undefined {
  const raw = process.env.OWNER_ADMIN_UI_PATH?.trim();
  if (!raw) return undefined;
  if (!raw.startsWith("/")) {
    throw new Error("OWNER_ADMIN_UI_PATH must start with / (e.g. /ingest-secret-abc/article)");
  }
  if (raw.includes("..") || raw.includes("?") || raw.includes("#")) {
    throw new Error("OWNER_ADMIN_UI_PATH must be a simple path without .. ? or #");
  }
  const normalized = raw.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    throw new Error("OWNER_ADMIN_UI_PATH cannot be /; use an unguessable path.");
  }
  return normalized;
}

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

/** Browser origins allowed to call this API (split deploy). Empty = reflect any origin (cors origin: true). */
function readCorsAllowedOrigins(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS?.trim();
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean))];
}

const appUrl = readPublicAppUrl(port);

export const config = {
  appEnv: process.env.NODE_ENV ?? "development",
  port,
  appUrl,
  llmProvider,
  llmApiKey: readProviderApiKey(llmProvider),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  fireworksBaseUrl: process.env.FIREWORKS_BASE_URL ?? "https://api.fireworks.ai/inference/v1",
  fireworksModel: process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/deepseek-v4-pro",
  databaseUrl: readEnv("DATABASE_URL"),
  /** Internal Coolify-friendly scheduler interval. Default: every 10 minutes. */
  internalPipelineIntervalMs: readOptionalInt("INTERNAL_PIPELINE_INTERVAL_MS", 10 * 60 * 1000),
  disableInternalPipelineCron: process.env.DISABLE_INTERNAL_PIPELINE_CRON === "true",
  /**
   * Internal timer + /api/cron/pipeline skip starting work if a pipeline row was created within this window.
   * Prevents duplicate overlapping runs when an external cron and the internal timer both fire. HTTP /api/pipeline/run ignores this.
   */
  pipelineCoalesceMs: readOptionalInt("PIPELINE_COALESCE_MS", 7 * 60 * 1000),
  /**
   * Hard ceiling for one pipeline pass. If a hung LLM/fetch never returns, the in-memory
   * single-flight lock is released after this so later ticks can publish again. Default 12m.
   */
  pipelineRunTimeoutMs: readOptionalInt("PIPELINE_RUN_TIMEOUT_MS", 12 * 60 * 1000),
  /** Optional shared secret for GET /api/cron/pipeline?secret=… (UptimeRobot / Coolify scheduled tasks / GitHub Actions). */
  cronSecret: process.env.CRON_SECRET,
  /** Same secret as CLI admin; required for POST /api/admin/article-from-url */
  ownerCliSecret: process.env.OWNER_CLI_SECRET?.trim() || undefined,
  /**
   * Secret path for the owner-only HTML form (e.g. `/ingest-7f3a9c2d1e8b/article`).
   * If unset, no GET UI is registered — use CLI or POST with curl only.
   */
  ownerAdminUiPath: readOwnerAdminUiPath(),
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
  /** If non-empty, only these origins get CORS headers (use when static site is on another domain). */
  corsAllowedOrigins: readCorsAllowedOrigins(),
  /** Disk cache for generated TTS chunks. Use persistent storage on private servers. */
  ttsCacheDir: process.env.TTS_CACHE_DIR?.trim() || ".cache/tts",
  /** Edge TTS speaking rate for generated audio. Examples: +0%, +15%, -10%. */
  ttsRate: process.env.TTS_RATE?.trim() || "+18%",
  resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  postalApiUrl: process.env.POSTAL_API_URL?.trim().replace(/\/+$/, "") || undefined,
  postalApiKey: process.env.POSTAL_API_KEY?.trim() || undefined,
  newsletterFrom: process.env.NEWSLETTER_FROM?.trim() || undefined,
  newsletterReplyTo: process.env.NEWSLETTER_REPLY_TO?.trim() || undefined,
  /** Local hours (0-23) at which a digest is sent, e.g. "8,20" for morning + night. */
  newsletterDigestHours: readDigestHours("NEWSLETTER_DIGEST_HOURS", [8, 20]),
  newsletterTimezone: process.env.NEWSLETTER_TIMEZONE?.trim() || "America/Los_Angeles",
  disableNewsletterSender: process.env.DISABLE_NEWSLETTER_SENDER === "true",
  /**
   * IndexNow key (a UUID) for instant Bing/Yandex indexing on publish.
   * When set, a `<key>.txt` file is served and the pipeline pings IndexNow after each publish.
   */
  indexNowKey: process.env.INDEXNOW_KEY?.trim() || undefined,
};

export function isProduction() {
  return config.appEnv === "production";
}
