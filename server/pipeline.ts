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

/**
 * Core logic to process a single trending topic into a published news post.
 */
async function processTopic(topic: TrendCandidate): Promise<PipelineRunResult> {
  const runId = makeRunId();
  await createRun(runId, topic);

  const sourcesToTry = PREFERRED_SOURCES.filter(s => s !== topic?.primarySource?.sourceName);
  const attempts: SourceAttempt[] = [];
  
  // Process sources sequentially to minimize memory spikes on Render
  for (const sourceName of sourcesToTry) {
    attempts.push(await attemptSource(topic, sourceName));
  }

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

  try {
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
    return published;
  } catch (error) {
    const failed: PipelineRunResult = {
      runId,
      topic,
      successfulSources,
      failedSources,
      published: false,
      reason: `Synthesis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
    await completeRun(failed);
    return failed;
  }
}

export async function runPipeline() {
  const topics = await getTrendingTopics();
  const existing = await fetchRecentPosts();
  
  // Find topics that haven't been successfully published recently
  const freshTopics = topics.filter(candidate => !existing.some(p => p.topic === candidate.topic));

  if (freshTopics.length === 0) {
    const runId = makeRunId();
    await createRun(runId, null);
    const emptyResult: PipelineRunResult = {
      runId,
      topic: null,
      successfulSources: [],
      failedSources: [],
      published: false,
      reason: "Rejected: no new trending topics could be derived.",
    };
    await completeRun(emptyResult);
    return [emptyResult];
  }

  // Process a batch of up to 3 topics in parallel
  const BATCH_SIZE = 3;
  const targets = freshTopics.slice(0, BATCH_SIZE);
  
  console.log(`🚀 Starting batch processing for ${targets.length} topics...`);
  
  const results: PipelineRunResult[] = [];
  for (const target of targets) {
    try {
      const res = await processTopic(target);
      results.push(res);
    } catch (err) {
      console.error(`Failed to process topic ${target.topic}:`, err);
    }
  }
  
  // Background task: update the events table
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

  return results;
}
