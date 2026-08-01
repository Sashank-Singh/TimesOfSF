# TimesOfSF

A San Francisco-focused news reader with a React frontend, an Express backend, a Postgres article store, and an automated LLM-powered news pipeline.

In production, the Docker/Coolify app serves both the public SPA and `/api/*` from the same Express process.

## Architecture

| Layer | Role |
| --- | --- |
| `src/` | Public React UI: articles, events, search, reader, TTS controls |
| `server/` | Express API, article pipeline, SEO HTML injection, Kokoro TTS |
| Postgres | Articles, pipeline runs, source attempts, events, newsletter subscribers, knowledge state |
| Docker/Coolify | Production runtime for the single Express + static app container |

## Requirements

- Node.js 22 for production parity with the Docker image
- Postgres connection string in `DATABASE_URL`
- Fireworks or Gemini API key
- Python/Kokoro dependencies are installed by the Docker image for production TTS

## Local Setup

1. Install dependencies:

```bash
npm ci
```

2. Create `.env` from `.env.example` and set at least:

```env
DATABASE_URL="postgresql://..."
LLM_PROVIDER=fireworks
FIREWORKS_API_KEY="..."
OWNER_CLI_SECRET="change-me-min-12-chars"
```

3. Run the backend:

```bash
npm run server:dev
```

4. Run the frontend in another terminal:

```bash
npm run dev
```

The dev frontend calls `http://localhost:8787` when `VITE_API_URL` is unset.

5. Smoke-test the production server locally:

```bash
npm run build
NODE_ENV=production npm run server:start
```

Open `http://localhost:8787`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run server:dev` | Express dev server with `tsx watch` |
| `npm run server:start` | Production Express entry |
| `npm run build` | Build the Vite app into `dist/` |
| `npm run lint` | Typecheck app and shared code |
| `npm run lint:server` | Typecheck server code |
| `npm run admin:articles` | Owner CLI for article edits |

## Environment

Full examples live in [.env.example](.env.example).

### Required

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres URL, SSL recommended for hosted DBs |
| `LLM_PROVIDER` | `fireworks` or `gemini` |
| `FIREWORKS_API_KEY` or `GEMINI_API_KEY` | Required for article synthesis |
| `OWNER_CLI_SECRET` | Owner/admin secret for protected operational routes |

### Deployment URLs

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public site URL used for metadata, sitemap, and canonical links |
| `PORT` | Express port, default `8787` |
| `VITE_API_URL` | Leave unset for default Coolify single-container deploy |
| `CORS_ALLOWED_ORIGINS` | Only needed for split frontend/API deployments |

For the default Coolify deployment, do not set `VITE_API_URL`; the browser should use same-origin `/api`.

### Pipeline Scheduling

The app no longer depends on Inngest. Coolify/private-server production uses the internal timer by default:

```env
INTERNAL_PIPELINE_INTERVAL_MS=600000
PIPELINE_COALESCE_MS=420000
DISABLE_INTERNAL_PIPELINE_CRON=false
```

Behavior:

- The first pipeline tick starts about 30 seconds after server boot.
- Later ticks run every `INTERNAL_PIPELINE_INTERVAL_MS`.
- A single-flight guard prevents overlapping pipeline runs.
- `PIPELINE_COALESCE_MS` skips near-duplicate timer/external-cron attempts.
- A tick attempts to publish; it does not guarantee a new article every time.

Optional external cron:

```env
CRON_SECRET="change-me-long-random-secret"
```

Then call:

```text
GET /api/cron/pipeline?secret=...
```

Manual pipeline runs also accept `CRON_SECRET` or `OWNER_CLI_SECRET`.

### Newsletter Delivery

Newsletter signup stores the email and selected categories in Postgres. Actual email delivery is disabled until a Postal mail server is configured:

```env
POSTAL_API_URL="https://email.example.com"
POSTAL_API_KEY="postal-server-api-key"
NEWSLETTER_FROM="Times of SF <news@timesofsf.com>"
NEWSLETTER_REPLY_TO="hello@timesofsf.com"
NEWSLETTER_INTERVAL_MS=600000
NEWSLETTER_BATCH_LIMIT=25
DISABLE_NEWSLETTER_SENDER=false
```

`POSTAL_API_URL`/`POSTAL_API_KEY` come from a Postal mail server whose sending domain (matching `NEWSLETTER_FROM`) has been added and DNS-verified (SPF/DKIM/MX) in that Postal instance's admin UI.

Behavior:

- Subscribers receive only new articles published after they subscribed.
- Articles are filtered against each subscriber's selected categories.
- `newsletter_deliveries` records each subscriber/article pair so stories are not resent.
- Each email includes a tokenized unsubscribe link.
- The internal sender runs every `NEWSLETTER_INTERVAL_MS` when Postal is configured.
- `POST /api/cron/newsletter` can manually run delivery with `CRON_SECRET` or `OWNER_CLI_SECRET`.

### TTS

TTS uses local Kokoro in production. The Docker image installs `kokoro-onnx`, `espeak-ng`, and downloads model files.

Recommended persistent cache on Coolify/private servers:

```env
TTS_CACHE_DIR="/var/lib/timesofsf/tts-cache"
```

Audio is stored as WAV:

- Chunk cache: `TTS_CACHE_DIR/<hash>.wav`
- Full-article cache: `TTS_CACHE_DIR/articles/<article-key>.wav`

TTS routes have per-IP rate limits and size caps. The persistent worker has a timeout so a failed Python process cannot leave the queue stuck.

`TTS_RATE` is legacy from Edge TTS and is not used by the current Kokoro path.

## Protected Routes

Use one of these auth styles:

- `Authorization: Bearer <secret>`
- `x-admin-secret: <OWNER_CLI_SECRET>`
- `x-cron-secret: <CRON_SECRET>`
- `?secret=<secret>` where supported

| Route | Auth |
| --- | --- |
| `POST /api/admin/article-from-url` | `OWNER_CLI_SECRET` |
| `POST /api/pipeline/run` | `OWNER_CLI_SECRET` or `CRON_SECRET` |
| `GET /api/cron/pipeline` | `OWNER_CLI_SECRET` or `CRON_SECRET` |
| `POST /api/cron/newsletter` | `OWNER_CLI_SECRET` or `CRON_SECRET` |
| `GET /api/runs/:runId` | `OWNER_CLI_SECRET` |
| `POST /api/posts/:id/expand` | `OWNER_CLI_SECRET` |

Public routes used by the frontend:

- `GET /api/posts`
- `GET /api/events`
- `POST /api/newsletter/subscribe` with `{ email, preferences, source }`; `preferences` accepts one or more article categories such as `Tech`, `Civics`, `Funding`, `Culture`, `Transit`, `Food`, or `Events`. `Politics`/`Political` are saved as `Civics`.
- `POST /api/tips` with `{ postSlug?, kind, message, contactEmail? }` — reader tips/corrections, rate-limited.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/auth/preferences` — password-based accounts (`tosf_session` httpOnly cookie), rate-limited.
- `GET/POST/DELETE /api/bookmarks(/:postId)` — requires a signed-in session.
- `GET /health`
- TTS playback/download routes, rate-limited

## Coolify Notes

The [Dockerfile](Dockerfile) builds the frontend and starts Express with:

```bash
npm run server:start
```

Set runtime environment variables in Coolify, not build-only variables:

- `DATABASE_URL`
- `LLM_PROVIDER`
- `FIREWORKS_API_KEY` or `GEMINI_API_KEY`
- `OWNER_CLI_SECRET`
- `APP_URL`
- `TTS_CACHE_DIR`
- optional `CRON_SECRET`

After deploy, check:

```text
https://your-domain.com/health
```

Expected scheduler shape:

```json
{
  "internalPipelineCron": {
    "active": true,
    "intervalMs": 600000
  }
}
```

## Validation

Run before pushing:

```bash
npm run lint
npm run lint:server
npm run build
npm audit --audit-level=moderate
```

## Tech Stack

React 19, Vite 6, Tailwind 4, Express, Postgres, Fireworks/Gemini, Kokoro TTS, TypeScript.

## License

Private project.
