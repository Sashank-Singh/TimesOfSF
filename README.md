# TimesOfSF

A **San Francisco–focused news reader** with a **React** frontend and an **Express** backend. The server runs a content pipeline (RSS and related sources), stores articles in **Postgres** (e.g. Neon), and uses an **LLM** (Fireworks or Google Gemini) for synthesis and tooling.

---

## Architecture


| Layer                     | Role                                                           |
| ------------------------- | -------------------------------------------------------------- |
| **Vite + React** (`src/`) | Public UI: articles, events, search                            |
| **Express** (`server/`)   | REST API, pipeline orchestration, static `dist/` in production |
| **Postgres**              | Posts, runs, events, pipeline metadata                         |


In **production** (Docker / Coolify), one process serves both the SPA and `/api/`* from the same origin. That avoids CORS for normal browsing.

---

## Prerequisites

- **Node.js 22** (matches the Docker image)
- **PostgreSQL** connection string (`DATABASE_URL`)
- **LLM**: [Fireworks](https://fireworks.ai/) and/or [Google AI Studio / Gemini](https://aistudio.google.com/) — see [Environment](#environment)

---

## Quick start (local)

1. **Clone and install**
  ```bash
   npm ci
  ```
2. **Configure environment**
  Copy `.env.example` to `.env` and fill in at least:
  - `DATABASE_URL`
  - `FIREWORKS_API_KEY` *or* `GEMINI_API_KEY` (and optionally `LLM_PROVIDER=fireworks` or `gemini`)
3. **Run the API** (default port **8787**)
  ```bash
   npm run server:dev
  ```
4. **Run the frontend** (default port **3000**)
  In another terminal:
   The dev client is configured to call the API at `http://localhost:8787` when `VITE_API_URL` is unset.
5. **Production build (smoke test)**
  ```bash
   npm run build
   NODE_ENV=production npm run server:start
  ```
   Open `http://localhost:8787` — static assets and `/api/*` are served together.

---

## Scripts


| Command                  | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`            | Vite dev server (frontend)                                             |
| `npm run server:dev`     | Express with `tsx watch`                                               |
| `npm run server:start`   | Production server entry                                                |
| `npm run build`          | Vite → `dist/`                                                         |
| `npm run lint`           | Typecheck app                                                          |
| `npm run lint:server`    | Typecheck server                                                       |
| `npm run admin:articles` | Owner CLI for article edits (needs `DATABASE_URL`, `OWNER_CLI_SECRET`) |


---

## Environment

Full examples and comments live in `**[.env.example](.env.example)**`. Summary:

### Required


| Variable                                    | Notes                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Postgres (SSL recommended for hosted DBs)                                                                      |
| `FIREWORKS_API_KEY` **or** `GEMINI_API_KEY` | At least one LLM key                                                                                           |
| `LLM_PROVIDER`                              | Optional but recommended: `fireworks` or `gemini` (if both keys exist, Fireworks wins unless you set `gemini`) |


### URLs and deploys


| Variable               | Notes                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_URL`              | Public site URL (links, metadata). On Coolify you can rely on `COOLIFY_URL` / `COOLIFY_FQDN` if unset                                    |
| `PORT`                 | Listen port (default **8787**)                                                                                                           |
| `VITE_API_URL`         | **Leave unset** for the default single-container deploy (same-origin `/api`). Set only if the browser must call another host             |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins when the **static site and API are on different hosts** (e.g. `https://www.timesofsf.com,https://timesofsf.com`) |


### Fireworks (optional tuning)


| Variable             | Default                                            |
| -------------------- | -------------------------------------------------- |
| `FIREWORKS_BASE_URL` | `https://api.fireworks.ai/inference/v1`            |
| `FIREWORKS_MODEL`    | `accounts/fireworks/models/llama-v3p1-8b-instruct` |


### Pipeline & scheduling

By default the server runs the pipeline with an internal timer every 10 minutes (`INTERNAL_PIPELINE_INTERVAL_MS=600000`). Optional: `CRON_SECRET` for `GET /api/cron/pipeline?secret=…`, `DISABLE_INTERNAL_PIPELINE_CRON` if using an external Coolify scheduled task instead, `PIPELINE_COALESCE_MS`, `SERPER_API_KEY`, and others — see `server/config.ts` for the full list and defaults. Manual pipeline routes require either `CRON_SECRET` or `OWNER_CLI_SECRET`.

### Owner-only tools


| Variable              | Purpose                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `OWNER_CLI_SECRET`    | Required for `POST /api/admin/article-from-url` and `npm run admin:articles`                         |
| `OWNER_ADMIN_UI_PATH` | Optional secret path (must start with `/`) for a small HTML ingest form; requires `OWNER_CLI_SECRET` |


---

## Docker & Coolify

The `**[Dockerfile](Dockerfile)`** builds the Vite app and runs `npm run server:start`. The image includes **curl** for Docker healthchecks.

- **Health:** `GET /health`
- **Do not** set `VITE_API_URL` at **image build** if you want the browser to use same-origin `/api` on your public domain.
- Set **runtime** secrets in Coolify: `DATABASE_URL`, LLM keys, `APP_URL` (if needed), `NODE_ENV=production`.

---

## API overview

Public read endpoints used by the SPA:

- `GET /api/posts` — recent articles  
- `GET /api/events` — stored events  

Operational / owner (see server code for auth and bodies):

- `GET /health` — liveness + pipeline summary JSON  
- `GET /api/cron/pipeline` — optional cron trigger (`CRON_SECRET`)  
- `POST /api/pipeline/run` — run the pipeline immediately (`CRON_SECRET` or `OWNER_CLI_SECRET`)  
- `GET /api/runs/:runId` — inspect a pipeline run (`OWNER_CLI_SECRET`)  
- `POST /api/posts/:id/expand` — expand article body (`OWNER_CLI_SECRET`)  
- `POST /api/admin/article-from-url` — publish from URL (`OWNER_CLI_SECRET`)  

---

## Tech stack

React 19, Vite 6, Tailwind 4, Express, Postgres, Fireworks OpenAI-compatible API or `@google/genai`, TypeScript.

---

## License

Private project (`"private": true` in `package.json`). Adjust this section if you open-source the repo.
