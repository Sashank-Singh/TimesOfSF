import crypto from "node:crypto";
import { synthesizePost } from "./agents";
import { completeRun, createRun, fetchRecentPosts, saveGeneratedPost, saveSourceAttempt } from "./db";
import { extractSource } from "./extractor";
import { config } from "./config";
import { findSourceArticle, getTrendingTopics } from "./rss";
import { PipelineRunResult, PreferredSourceName, SourceAttempt, SourceExtraction, TrendCandidate } from "./types";

const PREFERRED_SOURCES: PreferredSourceName[] = [
  "TechCrunch",
  "Bloomberg",
  "Reuters",
  "AP News"
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
  
  // Find the first topic that hasn't been successfully published recently
  let topic = null;
  const existing = await fetchRecentPosts();
  for (const candidate of topics) {
    if (!existing.some(p => p.topic === candidate.topic)) {
      topic = candidate;
      break;
    }
  }

  // FALLBACK: If no new topics, pick the top trending one anyway for testing/re-generation
  if (!topic && topics.length > 0) {
    topic = topics[0];
  }

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

  const sourcePromises = PREFERRED_SOURCES.map((sourceName) => attemptSource(topic, sourceName));
  const attempts = await Promise.all(sourcePromises);

  if (topic.primarySource) {
    try {
      const primaryResult = await extractSource(topic.primarySource);
      attempts.push({
        sourceName: topic.primarySource.sourceName,
        status: "success",
        result: primaryResult,
      });
    } catch (error) {
      attempts.push({
        sourceName: topic.primarySource.sourceName,
        status: "failed",
        reason: error instanceof Error ? error.message : "Primary source extraction failed.",
      });
    }
  }

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
  
  // High-fidelity Image Selection
  const sourceWithImage = successfulSources.find(s => s.imageUrl && s.imageUrl.startsWith("http"));
  if (sourceWithImage?.imageUrl) {
    post.imageUrl = sourceWithImage.imageUrl;
  } else {
    const { searchGoogleImage } = await import("./extractor");
    post.imageUrl = await searchGoogleImage(topic.topic);
  }

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

  // Background task: also update the events table during pipeline run
  try {
    const { fetchEvents } = await import("./events");
    const { saveEvents } = await import("./db");
    const extractedEvents = await fetchEvents();
    if (extractedEvents.length > 0) {
      await saveEvents(extractedEvents);
    }
  } catch (err) {
    console.error("Pipeline failed to update events:", err);
  }

  return published;
}
