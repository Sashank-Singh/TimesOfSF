CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  topic TEXT,
  normalized_topic TEXT,
  reason TEXT,
  successful_source_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

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
);

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
);
