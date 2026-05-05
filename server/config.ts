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
  appUrl: process.env.APP_URL ?? "http://localhost:8787",
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
  pipelineCron: process.env.PIPELINE_CRON ?? "0 * * * *",
  minSuccessfulSources: readOptionalInt("MIN_SUCCESSFUL_SOURCES", 2),
  sourceTimeoutMs: readOptionalInt("SOURCE_TIMEOUT_MS", 15000),
  trendLimit: readOptionalInt("TREND_LIMIT", 20),
  serperApiKey: process.env.SERPER_API_KEY,
};

export function isProduction() {
  return config.appEnv === "production";
}
