# Production image: Express API + Vite static (Coolify / Docker).
# Skips Python/news-please in the image (RSS/HTML fallback only); set SKIP_NEWS_PLEASE_POSTINSTALL=0 only if you extend the image with Python yourself.
FROM node:22-bookworm-slim

# Coolify expects curl or wget in the image for Docker-based health checks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV SKIP_NEWS_PLEASE_POSTINSTALL=1
ENV DISABLE_NEWS_PLEASE=true

COPY package.json package-lock.json ./
# postinstall runs during npm ci; script must exist before COPY . .
COPY scripts/postinstall-newsplease.mjs scripts/postinstall-newsplease.mjs
RUN npm ci

COPY . .
# Same-origin: do not pass VITE_API_URL at image build (Coolify build args); Express serves /api + dist on one host.
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8787}/health" >/dev/null || exit 1'

CMD ["npm", "run", "server:start"]
