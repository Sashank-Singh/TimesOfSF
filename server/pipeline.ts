import crypto from "node:crypto";
import { buildEventsDigestPost, finalizePostForPublish, synthesizePost } from "./agents";
import {
  classifyEditorialCategory,
  fetchQuotaSeedCandidate,
  getStaleCategories,
  prioritizeCandidates,
  topicAlreadyPublished,
  type ExistingPostSummary,
} from "./editorial";
import type { EventInfo } from "./events";
import {
  completeRun,
  createRun,
  fetchLatestPipelineRunCreatedAt,
  fetchRecentPosts,
  fetchRelatedKnowledge,
  fetchRecentKnowledgeState,
  saveGeneratedPost,
  saveKnowledgeState,
  saveSourceAttempt,
  type KnowledgeStateEntry,
} from "./db";
import { extractSource } from "./extractor";
import { config } from "./config";
import { buildStoryFingerprint, findDuplicateStory, normalizeHeadline, normalizeUrl } from "./dedupe";
import { findSourceArticle, getTrendingTopics, scanUnprocessedFeedItems } from "./rss";
import { PipelineRunResult, PreferredSourceName, SourceAttempt, SourceExtraction, TrendCandidate } from "./types";
import type { PreviousCoverage } from "./agents";

const PREFERRED_SOURCES: PreferredSourceName[] = [
  "Reuters",
  "AP News",
  "Bloomberg",
  "TechCrunch",
  "The Verge",
  "BBC",
  "New York Times",
  "The San Francisco Standard",
  "Mission Local",
  "Fox News",
  "Engadget",
  "San Francisco Chronicle",
  "VentureBeat",
  "Wired",
  "CNBC",
  "Axios",
  "GeekWire",
  "Product Hunt",
  "Hacker News",
  "Y Combinator",
  "Hugging Face",
  "Crunchbase News",
  "CB Insights",
  "The Information",
  "PitchBook News",
  "Sifted",
  "Fast Company",
  "Business Insider",
];

function makeRunId() {
  return `run_${crypto.randomUUID()}`;
}

function validateGrounding(topic: TrendCandidate, sources: SourceExtraction[]) {
  if (sources.length < config.minSuccessfulSources) {
    return `Rejected: only ${sources.length} source(s) were accessible; minimum is ${config.minSuccessfulSources}.`;
  }

  const totalFacts = sources.reduce((count, source) => count + source.facts.length, 0);
  if (totalFacts < config.minSuccessfulSources) {
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

function normalizeForCopyrightCheck(text: string) {
  return text
    .toLowerCase()
    .replace(/[`*_#[\]()]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(text: string, size = 8) {
  const words = normalizeForCopyrightCheck(text).split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let index = 0; index <= words.length - size; index += 1) {
    grams.add(words.slice(index, index + size).join(" "));
  }
  return grams;
}

export function findCopyrightRisk(generatedText: string, sources: SourceExtraction[]) {
  const generated = ngrams(generatedText);
  if (!generated.size) return null;

  for (const source of sources) {
    const sourceGrams = ngrams(source.textExcerpt);
    if (!sourceGrams.size) continue;
    const overlap = [...sourceGrams].filter((gram) => generated.has(gram)).length;
    const ratio = overlap / Math.min(sourceGrams.size, generated.size);
    if (overlap >= config.copyrightOverlapGramThreshold || ratio >= config.copyrightOverlapRatioThreshold) {
      return `${source.sourceName} has excessive phrase overlap with generated copy`;
    }
  }

  return null;
}

/** Hero image only from the quoted / primary story when possible—never a random successful fetch. */
export function pickHeroImageFromSources(
  sources: SourceExtraction[],
  topic: TrendCandidate,
): { url?: string; credit?: string } {
  const licensed = sources.find(
    (s) =>
      s.imageUrl?.startsWith("http") &&
      (s.allowedUse === "licensed" || s.allowedUse === "public_domain"),
  );
  if (licensed?.imageUrl) {
    return { url: licensed.imageUrl, credit: `${licensed.sourceName} — licensed reference` };
  }

  const primaryUrl = topic.primarySource?.articleUrl;
  if (primaryUrl) {
    const target = normalizeUrl(primaryUrl);
    const match = sources.find((s) => normalizeUrl(s.articleUrl) === target || normalizeUrl(s.canonicalUrl || s.articleUrl) === target);
    if (match?.imageUrl?.startsWith("http")) {
      return { url: match.imageUrl, credit: `${match.sourceName} article preview` };
    }
    return {};
  }

  for (const name of topic.signalSources ?? []) {
    const hit = sources.find((s) => s.sourceName === name && s.imageUrl?.startsWith("http"));
    if (hit) {
      return { url: hit.imageUrl!, credit: `${hit.sourceName} article preview` };
    }
  }

  const tokens = topic.normalizedTopic.split(/\s+/).filter((t) => t.length > 4);
  let best: SourceExtraction | undefined;
  let bestScore = 0;
  for (const s of sources) {
    if (!s.imageUrl?.startsWith("http")) continue;
    const hay = `${s.headline} ${s.summary}`.toLowerCase();
    const score = tokens.reduce((acc, t) => acc + (hay.includes(t.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best && bestScore >= 2) {
    return { url: best.imageUrl!, credit: `${best.sourceName} article preview` };
  }

  return {};
}

/** Drop RSS hits whose headline/summary barely overlaps the trend (prevents unrelated wires in one story). */
function keepsSourceAlignedWithTopic(topic: TrendCandidate, s: SourceExtraction): boolean {
  const primaryUrl = topic.primarySource?.articleUrl;
  if (primaryUrl) {
    const target = normalizeUrl(primaryUrl);
    if (
      normalizeUrl(s.articleUrl) === target ||
      normalizeUrl(s.canonicalUrl || s.articleUrl) === target
    ) {
      return true;
    }
  }

  const tokens = topic.normalizedTopic.split(/\s+/).filter((w) => w.length > 3);
  if (tokens.length === 0) return true;

  const hay = `${s.headline} ${s.summary}`.toLowerCase();
  const matched = tokens.filter((tok) => hay.includes(tok.toLowerCase())).length;
  // Require at least 2 significant token matches to confirm topical relevance
  const need = Math.max(2, Math.ceil(tokens.length * 0.35));
  return matched >= need;
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
async function processTopic(
  topic: TrendCandidate,
  existingPosts: Awaited<ReturnType<typeof fetchRecentPosts>>,
  previousCoverage?: PreviousCoverage[],
): Promise<PipelineRunResult> {
  const runId = makeRunId();
  await createRun(runId, topic);

  const sourcesToTry = [...new Set([...(topic.signalSources ?? []), ...PREFERRED_SOURCES])]
    .filter(s => s !== topic?.primarySource?.sourceName);
  const attempts: SourceAttempt[] = [];
  
  // Process sources sequentially to minimize memory spikes on constrained hosts
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

  const topicAlignedSources = successfulSources.filter((s) => keepsSourceAlignedWithTopic(topic, s));
  if (topicAlignedSources.length < config.minSuccessfulSources) {
    const rejected: PipelineRunResult = {
      runId,
      topic,
      successfulSources: topicAlignedSources,
      failedSources,
      published: false,
      reason: `Rejected: only ${topicAlignedSources.length} source(s) matched the trend headline after alignment filter (minimum ${config.minSuccessfulSources}).`,
    };
    await completeRun(rejected);
    return rejected;
  }

  const sourcesForStory = topicAlignedSources;

  const rejectionReason = validateGrounding(topic, sourcesForStory);
  if (rejectionReason) {
    const rejected: PipelineRunResult = {
      runId,
      topic,
      successfulSources: sourcesForStory,
      failedSources,
      published: false,
      reason: rejectionReason,
    };
    await completeRun(rejected);
    return rejected;
  }

  const duplicate = findDuplicateStory(topic, sourcesForStory, existingPosts);
  if (duplicate) {
    const rejected: PipelineRunResult = {
      runId,
      topic,
      successfulSources: sourcesForStory,
      failedSources,
      published: false,
      reason: `Rejected: duplicate story detected (${duplicate.reason}).`,
    };
    await completeRun(rejected);
    return rejected;
  }

  try {
    const post = await synthesizePost(topic, sourcesForStory, previousCoverage);
    const fingerprint = buildStoryFingerprint(topic, sourcesForStory, post.headline);
    post.sourceUrls = fingerprint.sourceUrls;
    post.headlineHash = fingerprint.headlineHash;
    post.canonicalKey = fingerprint.canonicalKey;
    post.storyFingerprint = fingerprint.storyFingerprint;

    const copyrightRisk = findCopyrightRisk(post.bodyMarkdown, sourcesForStory);
    if (copyrightRisk) {
      throw new Error(`Copyright safety check failed: ${copyrightRisk}`);
    }
    
    const hero = pickHeroImageFromSources(sourcesForStory, topic);
    if (hero.url) {
      post.imageUrl = hero.url;
      post.imageCredit = hero.credit;
    }

    const postId = await saveGeneratedPost(runId, post);

    // Track this article in knowledge state for future coverage context
    await saveKnowledgeState(post, topic.topic, sourcesForStory).catch((err) =>
      console.warn("Failed to save knowledge state:", err),
    );

    const published: PipelineRunResult = {
      runId,
      topic,
      successfulSources: sourcesForStory,
      failedSources,
      published: true,
      postId: postId?.toString(),
      publishedHeadline: post.headline,
    };
    await completeRun(published);
    return published;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.warn(`⚠️ Story not published (full synthesis required): ${msg}`);
    const failed: PipelineRunResult = {
      runId,
      topic,
      successfulSources: sourcesForStory,
      failedSources,
      published: false,
      reason: `Synthesis failed: ${msg}`,
    };
    await completeRun(failed);
    return failed;
  }
}

async function publishEventsDigestArticle(
  events: EventInfo[],
  existingPosts: Awaited<ReturnType<typeof fetchRecentPosts>>,
): Promise<PipelineRunResult | null> {
  if (!events.length) return null;

  const post = buildEventsDigestPost(events);
  const syntheticTopic: TrendCandidate = {
    topic: post.topic,
    normalizedTopic: normalizeHeadline(post.topic),
    signalCount: 1,
    sampleHeadlines: events.map((e) => e.title),
    editorialCategory: "Events",
    quotaSeed: true,
  };

  const duplicate = findDuplicateStory(syntheticTopic, [], existingPosts, post.headline);
  if (duplicate) {
    console.log(`⏭️ Skipping events digest (${duplicate.reason}).`);
    return null;
  }

  const runId = makeRunId();
  await createRun(runId, syntheticTopic);

  const fingerprint = buildStoryFingerprint(syntheticTopic, [], post.headline);
  post.sourceUrls = fingerprint.sourceUrls;
  post.headlineHash = fingerprint.headlineHash;
  post.canonicalKey = fingerprint.canonicalKey;
  post.storyFingerprint = fingerprint.storyFingerprint;

  try {
    const postId = await saveGeneratedPost(runId, post);
    const published: PipelineRunResult = {
      runId,
      topic: syntheticTopic,
      successfulSources: [],
      failedSources: [],
      published: true,
      postId: postId?.toString(),
    };
    await completeRun(published);
    return published;
  } catch (error) {
    const failed: PipelineRunResult = {
      runId,
      topic: syntheticTopic,
      successfulSources: [],
      failedSources: [],
      published: false,
      reason: `Events digest failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
    await completeRun(failed);
    return failed;
  }
}

export type RunPipelineOptions = {
  /**
   * When set (>0), skip if `pipeline_runs` shows an attempt newer than this window.
   * Used by the internal timer and cron pings—not by manual `/api/pipeline/run` or Inngest.
   */
  coalesceWithinMs?: number | null;
};

export async function runPipeline(options?: RunPipelineOptions) {
  const coalesceMs = options?.coalesceWithinMs;
  if (typeof coalesceMs === "number" && coalesceMs > 0) {
    const latest = await fetchLatestPipelineRunCreatedAt();
    if (latest) {
      const delta = Date.now() - latest.getTime();
      if (delta < coalesceMs) {
        console.log(
          `⏭️ Pipeline coalesced: last attempt ${Math.round(delta / 1000)}s ago (window ${Math.round(coalesceMs / 1000)}s).`,
        );
        return [
          {
            runId: `coalesce_${Date.now()}`,
            topic: null,
            successfulSources: [],
            failedSources: [],
            published: false,
            reason: `Coalesced: pipeline attempted ${Math.round(delta / 1000)}s ago.`,
          },
        ];
      }
    }
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  let existing = await fetchRecentPosts();

  const toSummary = (rows: typeof existing): ExistingPostSummary[] =>
    rows.map((p) => ({
      topic: p.topic,
      headline: p.headline,
      category: (p as { category?: string | null }).category,
      created_at: (p as { created_at?: Date | string }).created_at,
    }));

  let existingSummary = toSummary(existing);

  const staleLanes = getStaleCategories(existingSummary, DAY_MS);
  const quotaCandidates: TrendCandidate[] = [];

  const lanesToSeed = staleLanes.filter((lane) => lane !== "Events");
  const seedResults = await Promise.all(lanesToSeed.map((lane) => fetchQuotaSeedCandidate(lane)));
  for (const seed of seedResults) {
    if (seed && !topicAlreadyPublished(seed, existingSummary)) {
      quotaCandidates.push(seed);
    }
  }

  const trendingRaw = await getTrendingTopics();
  const trending = trendingRaw.map((t) => ({
    ...t,
    editorialCategory: t.editorialCategory ?? classifyEditorialCategory(t),
  }));

  const organicFresh = trending.filter((t) => !topicAlreadyPublished(t, existingSummary));
  const merged = prioritizeCandidates([...quotaCandidates, ...organicFresh]);

  console.log(
    `[pipeline] staleDesks=${staleLanes.length} quotaSeeds=${quotaCandidates.length} organicFresh=${organicFresh.length} merged=${merged.length}`,
  );

  const results: PipelineRunResult[] = [];
  const BATCH_SIZE = 10;

  // Hoisted state for both main batch and residue scan
  const recentKnowledge = await fetchRecentKnowledgeState(10).catch(() => []);
  const processedTopics: string[] = [...existing.map((p) => normalizeHeadline(p.topic || p.headline || ""))];
  const existingSnapshots = [...existing];

  if (merged.length === 0) {
    console.log("📭 No fresh trending buckets after quotas + dedupe.");
  } else {
    const targets = merged.slice(0, BATCH_SIZE);
    console.log(`🚀 Starting batch processing for ${targets.length} topics...`);

    for (const target of targets) {
      const targetLower = normalizeHeadline(target.topic);
      const targetTokens = targetLower.split(/\s+/).filter((t) => t.length > 3);

      const isDupWithinBatch = processedTopics.some((existingTopic) => {
        const existingTokens = existingTopic.split(/\s+/).filter((t) => t.length > 3);
        const overlap = targetTokens.filter((t) => existingTokens.includes(t));
        const ratio = overlap.length / Math.min(targetTokens.length, existingTokens.length);
        return ratio > 0.6;
      });

      if (isDupWithinBatch) {
        console.log(`⏭️ Skipping "${target.topic}" - too similar to existing content.`);
        continue;
      }

      // Find related knowledge state entries for coverage continuity
      const cat = target.editorialCategory ?? classifyEditorialCategory(target);
      const topicTokens = target.normalizedTopic.split(/\s+/).filter((t) => t.length > 4);
      const relatedPrev = recentKnowledge.filter(
        (k) =>
          k.category === cat && topicTokens.some((t) => k.keyEntities.some((e) => e.toLowerCase().includes(t))),
      );
      const prevCoverage: PreviousCoverage[] = relatedPrev.map((k) => ({
        topic: k.topic,
        headline: k.headline,
        keyFacts: k.keyFacts,
        publishedAt: k.publishedAt,
      }));

      try {
        const res = await processTopic(target, existingSnapshots, prevCoverage);
        results.push(res);
        if (res.published) {
          processedTopics.push(targetLower);
          const headlineForDedupe = res.publishedHeadline ?? target.topic;
          existingSnapshots.push({
            id: res.postId,
            topic: target.topic,
            headline: headlineForDedupe,
            category: target.editorialCategory ?? classifyEditorialCategory(target),
            sourceUrls: res.successfulSources.map((source) => source.canonicalUrl || source.articleUrl),
            credits: res.successfulSources.map((source) => ({
              sourceName: source.sourceName,
              articleUrl: source.articleUrl,
            })),
          } as Awaited<ReturnType<typeof fetchRecentPosts>>[number]);
        }
      } catch (err) {
        console.error(`Failed to process topic ${target.topic}:`, err);
      }
    }
  }

  // --- Residue scan: after the main batch, find strong stories we missed ---
  if (merged.length > BATCH_SIZE) {
    const remainingCount = merged.length - BATCH_SIZE;
    console.log(`🔍 ${remainingCount} topics didn't make the batch — scanning feeds for missed stories...`);
    const scanned = await scanUnprocessedFeedItems(processedTopics, 6).catch(() => []);
    const freshCandidates = scanned.filter(
      (c) =>
        !topicAlreadyPublished(
          { ...c, editorialCategory: c.editorialCategory ?? classifyEditorialCategory(c) },
          existingSummary,
        ),
    );
    if (freshCandidates.length > 0) {
      const bonusLimit = Math.min(freshCandidates.length, 5);
      console.log(`💡 Residue scan found ${freshCandidates.length} strong candidates; processing ${bonusLimit} more...`);
      for (const candidate of freshCandidates.slice(0, bonusLimit)) {
        const cat = candidate.editorialCategory ?? classifyEditorialCategory(candidate);
        const topicTokens = candidate.normalizedTopic.split(/\s+/).filter((t) => t.length > 4);
        const relatedPrev = recentKnowledge.filter(
          (k) => k.category === cat && topicTokens.some((t) => k.keyEntities.some((e) => e.toLowerCase().includes(t))),
        );
        const prevCoverage: PreviousCoverage[] = relatedPrev.map((k) => ({
          topic: k.topic,
          headline: k.headline,
          keyFacts: k.keyFacts,
          publishedAt: k.publishedAt,
        }));
        try {
          const res = await processTopic(candidate, existingSnapshots, prevCoverage);
          results.push(res);
          if (res.published) {
            processedTopics.push(normalizeHeadline(candidate.topic));
            existingSnapshots.push({
              id: res.postId,
              topic: candidate.topic,
              headline: res.publishedHeadline ?? candidate.topic,
              category: cat,
              sourceUrls: res.successfulSources.map((source) => source.canonicalUrl || source.articleUrl),
              credits: res.successfulSources.map((source) => ({
                sourceName: source.sourceName,
                articleUrl: source.articleUrl,
              })),
            } as Awaited<ReturnType<typeof fetchRecentPosts>>[number]);
          }
        } catch (err) {
          console.error(`Failed to process residue topic ${candidate.topic}:`, err);
        }
      }
    } else {
      console.log(`📭 No strong missed stories found in residue scan.`);
    }
  }

  try {
    const { fetchEvents } = await import("./events");
    const { saveEvents } = await import("./db");
    const extractedEvents = await fetchEvents();
    if (extractedEvents.length > 0) {
      await saveEvents(extractedEvents);
    }

    existing = await fetchRecentPosts();
    existingSummary = toSummary(existing);

    if (
      extractedEvents.length > 0 &&
      getStaleCategories(existingSummary, DAY_MS).includes("Events")
    ) {
      const digestResult = await publishEventsDigestArticle(extractedEvents, existing);
      if (digestResult) results.push(digestResult);
    }
  } catch (err) {
    console.error("Pipeline failed to update events:", err);
  }

  if (results.length === 0) {
    const runId = makeRunId();
    await createRun(runId, null);
    const emptyResult: PipelineRunResult = {
      runId,
      topic: null,
      successfulSources: [],
      failedSources: [],
      published: false,
      reason:
        "Rejected: no publishable stories this tick (quiet feeds, dedupe, grounding failure, or events digest already filed).",
    };
    await completeRun(emptyResult);
    return [emptyResult];
  }

  return results;
}
