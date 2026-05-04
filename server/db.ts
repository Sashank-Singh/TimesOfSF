import { neon } from "@neondatabase/serverless";
import { config } from "./config";
import { GeneratedPost, PipelineRunResult, SourceAttempt, SourceExtraction, TrendCandidate } from "./types";

const sql = neon(config.databaseUrl);

export async function ensureSchema() {
  await sql.transaction([
    sql`
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        topic TEXT,
        normalized_topic TEXT,
        reason TEXT,
        successful_source_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        published_at TIMESTAMPTZ
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS source_attempts (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        article_url TEXT,
        canonical_url TEXT,
        headline TEXT,
        published_at TIMESTAMPTZ,
        summary TEXT,
        text_excerpt TEXT,
        facts JSONB,
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    sql`
      CREATE TABLE IF NOT EXISTS generated_posts (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        headline TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        dek TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        short_post TEXT NOT NULL,
        credits JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
  ]);
}

export async function createRun(runId: string, topic: TrendCandidate | null) {
  await sql`
    INSERT INTO pipeline_runs (id, status, topic, normalized_topic)
    VALUES (${runId}, ${"running"}, ${topic?.topic ?? null}, ${topic?.normalizedTopic ?? null})
  `;
}

export async function saveSourceAttempt(runId: string, attempt: SourceAttempt) {
  const result = attempt.result;
  await sql`
    INSERT INTO source_attempts (
      run_id, source_name, status, article_url, canonical_url, headline, published_at,
      summary, text_excerpt, facts, failure_reason
    )
    VALUES (
      ${runId},
      ${attempt.sourceName},
      ${attempt.status},
      ${result?.articleUrl ?? null},
      ${result?.canonicalUrl ?? null},
      ${result?.headline ?? null},
      ${result?.publishedAt ?? null},
      ${result?.summary ?? null},
      ${result?.textExcerpt ?? null},
      ${result ? JSON.stringify(result.facts) : null},
      ${attempt.reason ?? null}
    )
  `;
}

export async function saveGeneratedPost(runId: string, post: GeneratedPost) {
  const inserted = (await sql`
    INSERT INTO generated_posts (run_id, topic, headline, slug, dek, body_markdown, short_post, credits)
    VALUES (
      ${runId},
      ${post.topic},
      ${post.headline},
      ${post.slug},
      ${post.dek},
      ${post.bodyMarkdown},
      ${post.shortPost},
      ${JSON.stringify(post.credits)}
    )
    RETURNING id
  `) as Array<{ id: number }>;
  return inserted[0]?.id;
}

export async function completeRun(result: PipelineRunResult) {
  await sql`
    UPDATE pipeline_runs
    SET
      status = ${result.published ? "published" : "rejected"},
      reason = ${result.reason ?? null},
      successful_source_count = ${result.successfulSources.length},
      published_at = ${result.published ? new Date().toISOString() : null}
    WHERE id = ${result.runId}
  `;
}

export async function fetchRecentPosts(limit = 10) {
  return sql`
    SELECT id, run_id, topic, headline, slug, dek, body_markdown, short_post, credits, created_at
    FROM generated_posts
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function fetchRun(runId: string) {
  const runs = await sql`
    SELECT *
    FROM pipeline_runs
    WHERE id = ${runId}
    LIMIT 1
  `;

  const attempts = await sql`
    SELECT *
    FROM source_attempts
    WHERE run_id = ${runId}
    ORDER BY id ASC
  `;

  return {
    run: runs[0] ?? null,
    attempts,
  };
}
