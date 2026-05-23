# Production image: Express API + Vite static (Coolify / Docker).
# Uses Mozilla Readability (pure JS) for full-article extraction — no Python dependency.
FROM node:22-bookworm-slim

# Coolify expects curl or wget in the image for Docker-based health checks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Download Kokoro-82M TTS model files for local inference (no Hugging Face download at runtime)
RUN chmod +x scripts/download-tts-model.sh && ./scripts/download-tts-model.sh

# Same-origin: do not pass VITE_API_URL at image build (Coolify build args); Express serves /api + dist on one host.
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8787}/health" >/dev/null || exit 1'

CMD ["npm", "run", "server:start"]
