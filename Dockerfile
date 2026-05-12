# Production image: Express API + Vite static (Coolify / Docker).
# Skips Python/news-please in the image (RSS/HTML fallback only); set SKIP_NEWS_PLEASE_POSTINSTALL=0 only if you extend the image with Python yourself.
FROM node:22-bookworm-slim

WORKDIR /app

ENV SKIP_NEWS_PLEASE_POSTINSTALL=1
ENV DISABLE_NEWS_PLEASE=true

COPY package.json package-lock.json ./
# postinstall runs during npm ci; script must exist before COPY . .
COPY scripts/postinstall-newsplease.mjs scripts/postinstall-newsplease.mjs
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "server:start"]
