import crypto from "node:crypto";
import postgres from "postgres";
import { config } from "./config";
import { filterEventsNextWeek } from "./events";
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
    await sql`ALTER TABLE generated_posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`;
    await sql`UPDATE generated_posts SET updated_at = created_at WHERE updated_at IS NULL`;
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
    await sql`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        source TEXT,
        preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
        unsubscribe_token TEXT UNIQUE,
        unsubscribed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT UNIQUE`;
    await sql`ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`;
    await sql`
      UPDATE newsletter_subscribers
      SET unsubscribe_token = md5(random()::text || clock_timestamp()::text || email)
      WHERE unsubscribe_token IS NULL
    `;
    await sql`CREATE INDEX IF NOT EXISTS newsletter_subscribers_created_idx ON newsletter_subscribers (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS newsletter_subscribers_unsubscribe_token_idx ON newsletter_subscribers (unsubscribe_token)`;
    await sql`
      CREATE TABLE IF NOT EXISTS newsletter_deliveries (
        id BIGSERIAL PRIMARY KEY,
        subscriber_id BIGINT NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
        post_id BIGINT NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (subscriber_id, post_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS newsletter_deliveries_sent_idx ON newsletter_deliveries (sent_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS tips (
        id BIGSERIAL PRIMARY KEY,
        post_id BIGINT REFERENCES generated_posts(id) ON DELETE SET NULL,
        post_slug TEXT,
        kind TEXT NOT NULL DEFAULT 'tip',
        message TEXT NOT NULL,
        contact_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS tips_created_idx ON tips (created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_hash TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_expires_at TIMESTAMPTZ`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT`;
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ`;
    await sql`CREATE INDEX IF NOT EXISTS users_verify_token_idx ON users (verify_token_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users (reset_token_hash)`;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token)`;
    await sql`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id BIGINT NOT NULL REFERENCES generated_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, post_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS bookmarks_user_idx ON bookmarks (user_id, created_at DESC)`;
    await sql`
      CREATE TABLE IF NOT EXISTS newsletter_digest_runs (
        id BIGSERIAL PRIMARY KEY,
        digest_key TEXT NOT NULL UNIQUE,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  });
}

export type UserRow = {
  id: number;
  email: string;
  passwordHash: string;
  preferences: string[];
  emailVerifiedAt: string | Date | null;
};

export async function createUser(email: string, passwordHash: string): Promise<UserRow> {
  const rows = await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${email}, ${passwordHash})
    RETURNING id, email, password_hash as "passwordHash", preferences, email_verified_at as "emailVerifiedAt"
  `;
  return rows[0] as any;
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const rows = await sql`
    SELECT id, email, password_hash as "passwordHash", preferences, email_verified_at as "emailVerifiedAt"
    FROM users
    WHERE email = ${email}
    LIMIT 1
  `;
  return rows[0] as any;
}

export async function touchUserLogin(userId: number) {
  await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${userId}`;
}

export async function updateUserPreferences(userId: number, preferences: string[]) {
  await sql`UPDATE users SET preferences = ${sql.json(preferences)} WHERE id = ${userId}`;
}

export async function createSession(userId: number, token: string, expiresAt: Date) {
  await sql`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (${userId}, ${token}, ${expiresAt})
  `;
}

export async function findSessionUser(token: string): Promise<UserRow | undefined> {
  const rows = await sql`
    SELECT u.id, u.email, u.password_hash as "passwordHash", u.preferences, u.email_verified_at as "emailVerifiedAt"
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] as any;
}

export async function deleteSession(token: string) {
  await sql`DELETE FROM sessions WHERE token = ${token}`;
}

/** Drop every session for a user — used after a password reset so stolen sessions die with it. */
export async function deleteAllSessionsForUser(userId: number) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

export async function purgeExpiredSessions() {
  await sql`DELETE FROM sessions WHERE expires_at < NOW()`;
}

export async function setVerifyToken(userId: number, tokenHash: string, expiresAt: Date) {
  await sql`
    UPDATE users
    SET verify_token_hash = ${tokenHash}, verify_expires_at = ${expiresAt}
    WHERE id = ${userId}
  `;
}

/** Consume a verification token. Returns true when it matched an unexpired token. */
export async function consumeVerifyToken(tokenHash: string): Promise<boolean> {
  const rows = await sql`
    UPDATE users
    SET email_verified_at = COALESCE(email_verified_at, NOW()),
        verify_token_hash = NULL,
        verify_expires_at = NULL
    WHERE verify_token_hash = ${tokenHash}
      AND verify_expires_at > NOW()
    RETURNING id
  `;
  return rows.length > 0;
}

export async function setResetToken(userId: number, tokenHash: string, expiresAt: Date) {
  await sql`
    UPDATE users
    SET reset_token_hash = ${tokenHash}, reset_expires_at = ${expiresAt}
    WHERE id = ${userId}
  `;
}

/** Swap a valid reset token for a new password. Returns the user id when it worked. */
export async function consumeResetToken(tokenHash: string, passwordHash: string): Promise<number | null> {
  const rows = await sql`
    UPDATE users
    SET password_hash = ${passwordHash},
        reset_token_hash = NULL,
        reset_expires_at = NULL,
        email_verified_at = COALESCE(email_verified_at, NOW())
    WHERE reset_token_hash = ${tokenHash}
      AND reset_expires_at > NOW()
    RETURNING id
  `;
  return rows.length > 0 ? Number(rows[0].id) : null;
}

export async function listBookmarkedPostIds(userId: number): Promise<string[]> {
  const rows = await sql`SELECT post_id as "postId" FROM bookmarks WHERE user_id = ${userId}`;
  return rows.map((r: any) => r.postId.toString());
}

export async function addBookmark(userId: number, postId: number) {
  await sql`
    INSERT INTO bookmarks (user_id, post_id)
    VALUES (${userId}, ${postId})
    ON CONFLICT (user_id, post_id) DO NOTHING
  `;
}

export async function removeBookmark(userId: number, postId: number) {
  await sql`DELETE FROM bookmarks WHERE user_id = ${userId} AND post_id = ${postId}`;
}

export async function saveTip(input: {
  postSlug?: string | null;
  kind: "tip" | "correction";
  message: string;
  contactEmail?: string | null;
}) {
  const post = input.postSlug ? await fetchPostBySlug(input.postSlug) : null;
  const rows = await sql`
    INSERT INTO tips (post_id, post_slug, kind, message, contact_email)
    VALUES (${post?.id ?? null}, ${input.postSlug ?? null}, ${input.kind}, ${input.message}, ${input.contactEmail ?? null})
    RETURNING id, created_at
  `;
  return rows[0] as { id: string | number; created_at: string | Date };
}

export async function fetchTips(limit = 200) {
  const rows = await sql`
    SELECT id, post_id as "postId", post_slug as "postSlug", kind, message, contact_email as "contactEmail", created_at as "createdAt"
    FROM tips
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as any[];
}

export async function saveNewsletterSubscriber(email: string, source?: string, preferences: string[] = []) {
  const unsubscribeToken = crypto.randomBytes(24).toString("hex");
  const rows = await sql`
    INSERT INTO newsletter_subscribers (email, source, preferences, unsubscribe_token)
    VALUES (${email}, ${source ?? null}, ${sql.json(preferences)}, ${unsubscribeToken})
    ON CONFLICT (email) DO UPDATE
    SET
      source = COALESCE(newsletter_subscribers.source, EXCLUDED.source),
      preferences = EXCLUDED.preferences,
      unsubscribe_token = COALESCE(newsletter_subscribers.unsubscribe_token, EXCLUDED.unsubscribe_token),
      unsubscribed_at = NULL
    RETURNING id, created_at
  `;
  return rows[0] as { id: string | number; created_at: string | Date };
}

export async function unsubscribeNewsletter(token: string): Promise<boolean> {
  const rows = await sql`
    UPDATE newsletter_subscribers
    SET unsubscribed_at = NOW()
    WHERE unsubscribe_token = ${token}
      AND unsubscribed_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export type DigestCandidatePost = {
  id: number;
  headline: string;
  slug: string;
  dek: string;
  category: string | null;
  citationCount: number;
};

export type DigestSubscriber = {
  id: number;
  email: string;
  unsubscribeToken: string;
  preferences: string[];
};

export async function hasDigestRun(digestKey: string): Promise<boolean> {
  const rows = await sql`SELECT id FROM newsletter_digest_runs WHERE digest_key = ${digestKey} LIMIT 1`;
  return rows.length > 0;
}

export async function recordDigestRun(digestKey: string) {
  await sql`
    INSERT INTO newsletter_digest_runs (digest_key)
    VALUES (${digestKey})
    ON CONFLICT (digest_key) DO NOTHING
  `;
}

export async function fetchDigestCandidatePosts(since: Date): Promise<DigestCandidatePost[]> {
  const rows = await sql`
    SELECT
      id,
      headline,
      slug,
      dek,
      category,
      jsonb_array_length(COALESCE(citations, '[]'::jsonb)) AS "citationCount"
    FROM generated_posts
    WHERE created_at >= ${since}
    ORDER BY created_at DESC
  `;
  return rows.map((row: any) => ({
    id: Number(row.id),
    headline: row.headline,
    slug: row.slug,
    dek: row.dek,
    category: row.category ?? null,
    citationCount: Number(row.citationCount) || 0,
  }));
}

export async function fetchActiveSubscribersForDigest(): Promise<DigestSubscriber[]> {
  const rows = await sql`
    SELECT id, email, unsubscribe_token as "unsubscribeToken", preferences
    FROM newsletter_subscribers
    WHERE unsubscribed_at IS NULL
  `;
  return rows.map((row: any) => ({
    id: Number(row.id),
    email: row.email,
    unsubscribeToken: row.unsubscribeToken,
    preferences: Array.isArray(row.preferences) ? row.preferences : [],
  }));
}

/** Returns a Set of "subscriberId:postId" keys already delivered, scoped to the given candidate posts. */
export async function fetchAlreadyDelivered(postIds: number[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const rows = await sql`
    SELECT subscriber_id as "subscriberId", post_id as "postId"
    FROM newsletter_deliveries
    WHERE post_id IN ${sql(postIds)}
  `;
  return new Set(rows.map((row: any) => `${row.subscriberId}:${row.postId}`));
}

export async function markNewsletterDelivered(subscriberId: number, postIds: number[]) {
  if (postIds.length === 0) return;
  await sql.begin(async (sql) => {
    for (const postId of postIds) {
      await sql`
        INSERT INTO newsletter_deliveries (subscriber_id, post_id)
        VALUES (${subscriberId}, ${postId})
        ON CONFLICT (subscriber_id, post_id) DO NOTHING
      `;
    }
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
  // Pull a wider pool, then keep only SF-today through +7 days (sorted soonest first).
  const rows = await sql`
    SELECT title, url, event_date as date, source
    FROM events
    ORDER BY created_at DESC
    LIMIT 100
  `;
  const mapped = rows.map((r: any) => ({
    title: r.title as string,
    url: r.url as string,
    date: r.date as string,
    source: r.source as string,
  }));
  return filterEventsNextWeek(mapped).slice(0, 24);
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
          ${sql.json(post.credits)},
          ${sql.json(post.citations ?? [])},
          ${sql.json(post.sourceUrls ?? [])},
          ${post.headlineHash ?? null},
          ${post.canonicalKey ?? null},
          ${post.storyFingerprint ? sql.json(post.storyFingerprint) : null},
          ${post.tldr ? sql.json(post.tldr) : null},
          ${post.entities ? sql.json(post.entities) : null},
          ${post.dataBlocks ? sql.json(post.dataBlocks) : null},
          ${post.editorialCategory ?? null}
        )
        RETURNING id
      `) as unknown as Array<{ id: number }>;
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
    SELECT slug, headline, image_url AS "imageUrl", created_at AS "publishedAt", COALESCE(updated_at, created_at) AS "updatedAt"
    FROM generated_posts
    WHERE slug IS NOT NULL AND TRIM(slug) <> ''
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r: any) => ({ slug: r.slug, headline: r.headline, imageUrl: r.imageUrl, publishedAt: r.publishedAt, updatedAt: r.updatedAt }));
}

export async function fetchRecentPosts(limit = 1000, searchQuery?: string) {
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = `%${searchQuery.trim()}%`;
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
        COALESCE(updated_at, created_at) as "updatedAt",
        created_at
      FROM generated_posts
      WHERE headline ILIKE ${q}
         OR dek ILIKE ${q}
         OR body_markdown ILIKE ${q}
         OR short_post ILIKE ${q}
      ORDER BY
        CASE
          WHEN headline ILIKE ${q} THEN 0
          ELSE 1
        END,
        created_at DESC
      LIMIT ${limit}
    `;
    return rows as any[];
  }

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
      COALESCE(updated_at, created_at) as "updatedAt",
      created_at
    FROM generated_posts
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows as any[];
}

export async function fetchPostsForSeoList(options: { category?: string; limit?: number } = {}) {
  const limit = options.limit ?? 24;
  if (options.category) {
    const rows = await sql`
      SELECT headline, slug, dek, category, created_at as "publishedAt"
      FROM generated_posts
      WHERE category = ${options.category}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows as any[];
  }
  const rows = await sql`
    SELECT headline, slug, dek, category, created_at as "publishedAt"
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
    SET body_markdown = ${content},
        updated_at = NOW()
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
