import crypto from "node:crypto";
import { rewritePostForCopyrightSafety, synthesizePost } from "./agents";
import { config } from "./config";
import { completeRun, createRun, fetchRecentPosts, saveGeneratedPost, saveSourceAttempt } from "./db";
import { buildStoryFingerprint, findDuplicateStory, normalizeHeadline } from "./dedupe";
import { extractSource } from "./extractor";
import { findCopyrightRisk, pickHeroImageFromSources } from "./pipeline";
import { withSourceMetadata } from "./sourceRegistry";
import type { EditorialCategory, PipelineRunResult, SourceAttempt, TrendCandidate } from "./types";
import { ALL_EDITORIAL_CATEGORIES } from "./types";

function makeRunId() {
  return `run_${crypto.randomUUID()}`;
}

function timingSafeSecret(ok: string | undefined, got: string | undefined): boolean {
  if (!ok || !got) return false;
  try {
    const a = Buffer.from(ok, "utf8");
    const b = Buffer.from(got, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function assertArticleFromUrlAuthorized(secret: string | undefined): boolean {
  return timingSafeSecret(config.ownerCliSecret, secret?.trim());
}

function normalizeArticleUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed.");
  u.hash = "";
  return u.toString();
}

function extractionStrongEnough(textExcerpt: string, facts: string[]): boolean {
  const excerptLen = (textExcerpt || "").trim().length;
  const factsLen = facts.join(" ").trim().length;
  return excerptLen >= 200 || factsLen >= 120;
}

/**
 * Ingest a single news URL, extract text (news-please or fallback), synthesize, and publish.
 * Does not use the scheduled trending pipeline.
 */
export async function publishArticleFromSubmittedUrl(
  rawUrl: string,
  options?: { editorialCategory?: EditorialCategory },
): Promise<PipelineRunResult> {
  const url = normalizeArticleUrl(rawUrl);

  const baseResult = withSourceMetadata({
    sourceName: "Submitted Link",
    articleUrl: url,
    headline: "Article",
    summary: "",
  });

  let extraction;
  try {
    extraction = await extractSource(baseResult);
  } catch (e) {
    const runId = makeRunId();
    const msg = e instanceof Error ? e.message : String(e);
    const failed: PipelineRunResult = {
      runId,
      topic: null,
      successfulSources: [],
      failedSources: [
        {
          sourceName: "Submitted Link",
          status: "failed",
          reason: msg,
        },
      ],
      published: false,
      reason: `Extraction failed: ${msg}`,
    };
    await createRun(runId, null);
    await saveSourceAttempt(runId, failed.failedSources[0]!);
    await completeRun(failed);
    return failed;
  }

  if (!extractionStrongEnough(extraction.textExcerpt, extraction.facts)) {
    const runId = makeRunId();
    const topic: TrendCandidate = {
      topic: extraction.headline,
      normalizedTopic: normalizeHeadline(extraction.headline),
      signalCount: 1,
      sampleHeadlines: [extraction.headline],
      primarySource: { ...baseResult, headline: extraction.headline, summary: extraction.summary },
    };
    await createRun(runId, topic);
    const attempt: SourceAttempt = {
      sourceName: "Submitted Link",
      status: "success",
      result: extraction,
    };
    await saveSourceAttempt(runId, attempt);
    const failed: PipelineRunResult = {
      runId,
      topic,
      successfulSources: [extraction],
      failedSources: [],
      published: false,
      reason:
        "Not enough article text was extracted (thin page or paywall). Try another URL or run locally with news-please enabled.",
    };
    await completeRun(failed);
    return failed;
  }

  const topic: TrendCandidate = {
    topic: extraction.headline,
    normalizedTopic: normalizeHeadline(extraction.headline),
    signalCount: 1,
    sampleHeadlines: [extraction.headline],
    primarySource: {
      ...baseResult,
      headline: extraction.headline,
      summary: extraction.summary || extraction.headline,
      imageUrl: extraction.imageUrl,
      publishedAt: extraction.publishedAt,
    },
    editorialCategory: options?.editorialCategory,
  };

  const runId = makeRunId();
  await createRun(runId, topic);

  const successAttempt: SourceAttempt = {
    sourceName: "Submitted Link",
    status: "success",
    result: extraction,
  };
  await saveSourceAttempt(runId, successAttempt);

  const existingPosts = await fetchRecentPosts(500);
  const dup = findDuplicateStory(topic, [extraction], existingPosts);
  if (dup) {
    const failed: PipelineRunResult = {
      runId,
      topic,
      successfulSources: [extraction],
      failedSources: [],
      published: false,
      reason: `Duplicate: ${dup.reason}`,
    };
    await completeRun(failed);
    return failed;
  }

  try {
    let post = await synthesizePost(topic, [extraction]);
    if (options?.editorialCategory && ALL_EDITORIAL_CATEGORIES.includes(options.editorialCategory)) {
      post.editorialCategory = options.editorialCategory;
    }
    const fingerprint = buildStoryFingerprint(topic, [extraction], post.headline);
    post.sourceUrls = fingerprint.sourceUrls;
    post.headlineHash = fingerprint.headlineHash;
    post.canonicalKey = fingerprint.canonicalKey;
    post.storyFingerprint = fingerprint.storyFingerprint;

    const copyrightRisk = findCopyrightRisk(post.bodyMarkdown, [extraction]);
    if (copyrightRisk) {
      post = await rewritePostForCopyrightSafety(post, copyrightRisk);
      const repairedRisk = findCopyrightRisk(post.bodyMarkdown, [extraction]);
      if (repairedRisk) {
        throw new Error(repairedRisk);
      }
    }

    const hero = await pickHeroImageFromSources([extraction], topic);
    if (hero.url) {
      post.imageUrl = hero.url;
      post.imageCredit = hero.credit;
    }

    const postId = await saveGeneratedPost(runId, post);
    const published: PipelineRunResult = {
      runId,
      topic,
      successfulSources: [extraction],
      failedSources: [],
      published: true,
      postId: postId?.toString(),
      publishedHeadline: post.headline,
    };
    await completeRun(published);
    return published;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown synthesis failure";
    const failed: PipelineRunResult = {
      runId,
      topic,
      successfulSources: [extraction],
      failedSources: [],
      published: false,
      reason: msg,
    };
    await completeRun(failed);
    return failed;
  }
}
