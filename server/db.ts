import crypto from "node:crypto";
import postgres from "postgres";
import { config } from "./config";
import { EditorialCategory, GeneratedPost, PipelineRunResult, SourceAttempt, SourceExtraction, TrendCandidate } from "./types";

const sql = postgres(config.databaseUrl);

export async function ensureSchema() {
  await sql.begin(async (sql) => {
    await sql`
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
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS source_attempts (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        source_name TEXT NOT NULL,
        status TEXT NOT NULL,
        article_url TEXT,
        canonical_url TEXT,
        headline TEXT,
        image_url TEXT,
        published_at TIMESTAMPTZ,
        summary TEXT,
        text_excerpt TEXT,
        facts JSONB,
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS generated_posts (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE REFERENCES pipeline_runs(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        headline TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        dek TEXT NOT NULL,
        image_url TEXT,
        body_markdown TEXT NOT NULL,
        short_post TEXT NOT NULL,
        credits JSONB NOT NULL,
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        headline_hash TEXT,
        canonical_key TEXT,
        story_fingerprint JSONB,
        tldr JSONB,
        entities JSONB,
        data_blocks JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS citations JSONB NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS source_urls JSONB NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS headline_hash TEXT`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS canonical_key TEXT`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS story_fingerprint JSONB`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS category TEXT`;
    await sql`CREATE INDEX IF NOT EXISTS generated_posts_headline_hash_idx ON generated_posts (headline_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS generated_posts_canonical_key_idx ON generated_posts (canonical_key)`;
    await sql`CREATE INDEX IF NOT EXISTS generated_posts_category_created_idx ON generated_posts (category, created_at DESC)`;
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS image_credit TEXT`;
    await sql`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        event_date TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS knowledge_state (
        id BIGSERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        topic TEXT NOT NULL,
        headline TEXT NOT NULL,
        slug TEXT NOT NULL,
        key_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
        key_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS knowledge_state_category_idx ON knowledge_state (category, published_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS knowledge_state_entities_gin ON knowledge_state USING GIN (key_entities)`;
  });
}

export async function saveEvents(events: Array<{title: string, url: string, date: string, source: string}>) {
  if (!events.length) return;
  await sql.begin(async (sql) => {
    await sql`TRUNCATE TABLE events`;
    for (const e of events) {
      await sql`
        INSERT INTO events (title, url, event_date, source)
        VALUES (${e.title}, ${e.url}, ${e.date}, ${e.source})
      `;
    }
  });
}

export async function fetchStoredEvents() {
  const rows = await sql`SELECT title, url, event_date as date, source FROM events ORDER BY created_at DESC LIMIT 16`;
  return rows.map((r: any) => ({ title: r.title, url: r.url, date: r.date, source: r.source }));
}

/** Latest pipeline attempt (includes rejected / empty ticks). */
export async function fetchLatestPipelineRunCreatedAt(): Promise<Date | null> {
  const rows = await sql`
    SELECT created_at FROM pipeline_runs ORDER BY created_at DESC LIMIT 1
  `;
  const raw = rows[0]?.created_at as string | Date | undefined;
  if (!raw) return null;
  const d = typeof raw === "string" ? new Date(raw) : raw;
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Lightweight snapshot for /health (debugging automations). */
export async function fetchPipelineActivitySummary() {
  const runRows = await sql`
    SELECT created_at, status, published_at, reason
    FROM pipeline_runs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const postRows = await sql`
    SELECT created_at FROM generated_posts ORDER BY created_at DESC LIMIT 1
  `;
  const r = runRows[0] as { created_at?: string | Date; status?: string; published_at?: string | Date | null; reason?: string | null } | undefined;
  const p = postRows[0] as { created_at?: string | Date } | undefined;
  return {
    lastRunAt: r?.created_at ?? null,
    lastRunStatus: r?.status ?? null,
    lastRunReason: r?.reason ?? null,
    lastPublishedPostAt: p?.created_at ?? null,
  };
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
      run_id, source_name, status, article_url, canonical_url, headline, image_url, published_at,
      summary, text_excerpt, facts, failure_reason
    )
    VALUES (
      ${runId},
      ${attempt.sourceName},
      ${attempt.status},
      ${result?.articleUrl ?? null},
      ${result?.canonicalUrl ?? null},
      ${result?.headline ?? null},
      ${result?.imageUrl ?? null},
      ${result?.publishedAt ?? null},
      ${result?.summary ?? null},
      ${result?.textExcerpt ?? null},
      ${result?.facts ?? null},
      ${attempt.reason ?? null}
    )
  `;
}

export async function saveGeneratedPost(runId: string, post: GeneratedPost) {
  // Retry with a unique slug if the original collides with an existing one
  const trySlug = async (slug: string): Promise<number | undefined> => {
    try {
      const inserted = (await sql`
        INSERT INTO generated_posts (
          run_id, topic, headline, slug, dek, image_url, image_credit, body_markdown, short_post, credits, citations,
          source_urls, headline_hash, canonical_key, story_fingerprint, tldr, entities, data_blocks, category
        )
        VALUES (
          ${runId},
          ${post.topic},
          ${post.headline},
          ${slug},
          ${post.dek},
          ${post.imageUrl ?? null},
          ${post.imageCredit ?? null},
          ${post.bodyMarkdown},
          ${post.shortPost},
          ${post.credits},
          ${post.citations ?? []},
          ${post.sourceUrls ?? []},
          ${post.headlineHash ?? null},
          ${post.canonicalKey ?? null},
          ${post.storyFingerprint ?? null},
          ${post.tldr ?? null},
          ${post.entities ?? null},
          ${post.dataBlocks ?? null},
          ${post.editorialCategory ?? null}
        )
        RETURNING id
      `) as Array<{ id: number }>;
      return inserted[0]?.id;
    } catch (err: any) {
      // If unique constraint violation on slug, retry with random suffix
      if (err?.code === "23505" && err?.detail?.includes("slug")) {
        return trySlug(`${slug}-${crypto.randomUUID().slice(0, 8)}`);
      }
      throw err;
    }
  };

  return trySlug(post.slug);
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

export async function fetchPostSlugDatesForSitemap(limit = 2000) {
  const rows = await sql`
    SELECT slug, created_at AS "publishedAt"
    FROM generated_posts
    WHERE slug IS NOT NULL AND TRIM(slug) <> ''
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r: any) => ({ slug: r.slug, publishedAt: r.publishedAt }));
}

export async function fetchRecentPosts(limit = 1000) {
  const rows = await sql`
    SELECT
      id,
      topic,
      headline,
      slug,
      dek,
      image_url as "imageUrl",
      image_credit as "imageCredit",
      body_markdown,
      short_post,
      credits,
      citations,
      source_urls as "sourceUrls",
      headline_hash as "headlineHash",
      canonical_key as "canonicalKey",
      story_fingerprint as "storyFingerprint",
      tldr,
      entities,
      data_blocks as "dataBlocks",
      category,
      created_at as "publishedAt",
      created_at
    FROM generated_posts
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as any[];
}

export async function fetchRun(runId: string) {
  const runs: any[] = await sql`
    SELECT *
    FROM pipeline_runs
    WHERE id = ${runId}
    LIMIT 1
  `;

  const attempts: any[] = await sql`
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
export async function fetchPostById(id: string) {
  const numericId = id.replace("db-", "");
  const result = await sql`
    SELECT
      *,
      source_urls as "sourceUrls",
      headline_hash as "headlineHash",
      canonical_key as "canonicalKey",
      story_fingerprint as "storyFingerprint",
      data_blocks as "dataBlocks"
    FROM generated_posts
    WHERE id = ${numericId}
  `;
  return result[0];
}

export async function fetchPostBySlug(slug: string) {
  const result = await sql`
    SELECT
      *,
      source_urls as "sourceUrls",
      headline_hash as "headlineHash",
      canonical_key as "canonicalKey",
      story_fingerprint as "storyFingerprint",
      data_blocks as "dataBlocks"
    FROM generated_posts
    WHERE slug = ${slug}
    LIMIT 1
  `;
  return result[0];
}

export async function updatePostContent(id: string, content: string) {
  const numericId = id.replace("db-", "");
  await sql`
    UPDATE generated_posts
    SET body_markdown = ${content}
    WHERE id = ${numericId}
  `;
}

export type KnowledgeStateEntry = {
  category: string;
  topic: string;
  headline: string;
  slug: string;
  keyEntities: string[];
  keyFacts: string[];
  sourceUrls: string[];
  publishedAt: Date;
};

export async function saveKnowledgeState(post: GeneratedPost, topic: string, sources: SourceExtraction[]) {
  const keyEntities = (post.entities ?? []).map((e) => e.name).slice(0, 12);
  const keyFacts = sources
    .flatMap((s) => s.facts ?? [])
    .filter((f) => f.length > 20)
    .slice(0, 8);
  const sourceUrls = sources.map((s) => s.articleUrl).filter(Boolean);

  await sql`
    INSERT INTO knowledge_state (category, topic, headline, slug, key_entities, key_facts, source_urls)
    VALUES (
      ${post.editorialCategory ?? "Tech"},
      ${topic},
      ${post.headline},
      ${post.slug},
      ${keyEntities},
      ${keyFacts},
      ${sourceUrls}
    )
  `;
}

export async function fetchRecentKnowledgeState(limit = 10): Promise<KnowledgeStateEntry[]> {
  const rows = await sql`
    SELECT category, topic, headline, slug,
           key_entities::text as "keyEntitiesRaw",
           key_facts::text as "keyFactsRaw",
           source_urls::text as "sourceUrlsRaw",
           published_at as "publishedAt"
    FROM knowledge_state
    ORDER BY published_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r: any) => ({
    category: r.category,
    topic: r.topic,
    headline: r.headline,
    slug: r.slug,
    keyEntities: safeParseJsonArray(r.keyEntitiesRaw, []),
    keyFacts: safeParseJsonArray(r.keyFactsRaw, []),
    sourceUrls: safeParseJsonArray(r.sourceUrlsRaw, []),
    publishedAt: new Date(r.publishedAt),
  }));
}

export async function fetchRelatedKnowledge(
  category: EditorialCategory,
  entityNames: string[],
  windowDays = 7,
): Promise<KnowledgeStateEntry[]> {
  if (entityNames.length === 0) return [];

  // Match by category + any overlapping entity name
  const rows = await sql`
    SELECT category, topic, headline, slug,
           key_entities::text as "keyEntitiesRaw",
           key_facts::text as "keyFactsRaw",
           source_urls::text as "sourceUrlsRaw",
           published_at as "publishedAt"
    FROM knowledge_state
    WHERE category = ${category}
      AND published_at >= NOW() - INTERVAL '1 day' * ${windowDays}
    ORDER BY published_at DESC
    LIMIT 5
  `;

  const entries: KnowledgeStateEntry[] = rows.map((r: any) => ({
    category: r.category,
    topic: r.topic,
    headline: r.headline,
    slug: r.slug,
    keyEntities: safeParseJsonArray(r.keyEntitiesRaw, []),
    keyFacts: safeParseJsonArray(r.keyFactsRaw, []),
    sourceUrls: safeParseJsonArray(r.sourceUrlsRaw, []),
    publishedAt: new Date(r.publishedAt),
  }));

  // Filter to only entries that share at least one entity with the new topic
  const entityLower = entityNames.map((n) => n.toLowerCase());
  return entries.filter((e) =>
    e.keyEntities.some((ke) => entityLower.includes(ke.toLowerCase())),
  );
}

function safeParseJson(raw: string | null | undefined, fallback: any): any {
  try {
    const parsed = JSON.parse(raw ?? "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeParseJsonArray(raw: string | null | undefined, fallback: any[] = []): any[] {
  const parsed = safeParseJson(raw, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}
