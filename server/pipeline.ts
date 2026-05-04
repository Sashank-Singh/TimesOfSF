import crypto from "node:crypto";
import { synthesizePost } from "./agents";
import { completeRun, createRun, saveGeneratedPost, saveSourceAttempt } from "./db";
import { extractSource } from "./extractor";
import { config } from "./config";
import { findSourceArticle, getTrendingTopics } from "./rss";
import { PipelineRunResult, PreferredSourceName, SourceAttempt, SourceExtraction, TrendCandidate } from "./types";

const PREFERRED_SOURCES: PreferredSourceName[] = [
  "San Francisco Chronicle",
  "TechCrunch",
  "Bloomberg",
  "Reuters",
  "WSJ",
];

function makeRunId() {
  return `run_${crypto.randomUUID()}`;
}

function validateGrounding(topic: TrendCandidate, sources: SourceExtraction[]) {
  if (sources.length < config.minSuccessfulSources) {
    return `Rejected: only ${sources.length} source(s) were accessible; minimum is ${config.minSuccessfulSources}.`;
  }

  const totalFacts = sources.reduce((count, source) => count + source.facts.length, 0);
  if (totalFacts < config.minSuccessfulSources * 2) {
    return "Rejected: evidence was too thin to safely synthesize.";
  }

  const topicTokens = topic.normalizedTopic.split(" ").filter((token) => token.length > 3);
  const tokenMatches = sources.some((source) =>
    topicTokens.some((token) => source.headline.toLowerCase().includes(token) || source.summary.toLowerCase().includes(token)),
  );

  if (!tokenMatches) {
    return "Rejected: source evidence did not align strongly enough with the selected trend topic.";
  }

  return null;
}

async function attemptSource(topic: TrendCandidate, sourceName: PreferredSourceName): Promise<SourceAttempt> {
  const match = await findSourceArticle(topic, sourceName);
  if (!match) {
    return {
      sourceName,
      status: "failed",
      reason: "No matching article found in source feed.",
    };
  }

  try {
    const result = await extractSource(match);
    return {
      sourceName,
      status: "success",
      result,
    };
  } catch (error) {
    return {
      sourceName,
      status: "failed",
      reason: error instanceof Error ? error.message : "Unknown extraction failure.",
    };
  }
}

export async function runPipeline() {
  const runId = makeRunId();
  const topics = await getTrendingTopics();
  const topic = topics[0] ?? null;
  await createRun(runId, topic);

  if (!topic) {
    const emptyResult: PipelineRunResult = {
      runId,
      topic: null,
      successfulSources: [],
      failedSources: [],
      published: false,
      reason: "Rejected: no trending topic could be derived from the configured trend feeds.",
    };
    await completeRun(emptyResult);
    return emptyResult;
  }

  const attempts = await Promise.all(PREFERRED_SOURCES.map((sourceName) => attemptSource(topic, sourceName)));

  for (const attempt of attempts) {
    await saveSourceAttempt(runId, attempt);
  }

  const successfulSources = attempts
    .filter((attempt): attempt is SourceAttempt & { result: SourceExtraction } => attempt.status === "success" && !!attempt.result)
    .map((attempt) => attempt.result);
  const failedSources = attempts.filter((attempt) => attempt.status === "failed");

  const rejectionReason = validateGrounding(topic, successfulSources);
  if (rejectionReason) {
    const rejected: PipelineRunResult = {
      runId,
      topic,
      successfulSources,
      failedSources,
      published: false,
      reason: rejectionReason,
    };
    await completeRun(rejected);
    return rejected;
  }

  const post = await synthesizePost(topic, successfulSources);
  const postId = await saveGeneratedPost(runId, post);

  const published: PipelineRunResult = {
    runId,
    topic,
    successfulSources,
    failedSources,
    published: true,
    postId: postId?.toString(),
  };
  await completeRun(published);
  return published;
}
