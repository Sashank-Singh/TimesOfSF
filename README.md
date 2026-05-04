<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Times of SF

This repo contains:

- a Vite/React frontend for the Times of SF reading experience
- a backend-only automated news pipeline that discovers trending tech topics, attempts evidence collection from preferred sources, validates source grounding, and publishes only when enough evidence is available

## Backend pipeline

The backend lives in [server](./server) and uses:

- `Inngest` for scheduled and manual workflow orchestration
- `Neon Postgres` for pipeline runs, source attempts, and generated posts
- `Gemini` or `Fireworks` for grounded synthesis

Publishing rule:

- try all 5 preferred sources
- continue when some fail
- publish only when at least 2 sources succeed and grounding checks pass

Preferred sources:

- San Francisco Chronicle
- TechCrunch
- Bloomberg
- Reuters
- WSJ

## Environment

Copy `.env.example` to `.env.local` or `.env` and set:

- `LLM_PROVIDER`
- either `GEMINI_API_KEY` or `FIREWORKS_API_KEY`
- `DATABASE_URL`
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`

For Fireworks, set:

- `LLM_PROVIDER=fireworks`
- `FIREWORKS_API_KEY`
- optionally `FIREWORKS_MODEL`

## Run locally

1. Install dependencies:
   `npm install`
2. Start the frontend:
   `npm run dev`
3. Start the backend:
   `npm run server:dev`

## Useful backend endpoints

- `GET /health`
- `POST /api/pipeline/run`
- `POST /api/pipeline/trigger`
- `GET /api/posts`
- `GET /api/runs/:runId`
- `POST /api/inngest`

## Typecheck

- Full frontend typecheck:
  `npm run lint`
- Backend-only typecheck:
  `npm run lint:server`
