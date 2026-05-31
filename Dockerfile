# Production image: Express API + Vite static (Coolify / Docker).
FROM node:22-bookworm-slim

# Python3 + kokoro-onnx for server-side TTS (local ONNX inference, no cloud API)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates python3 python3-pip espeak-ng \
  && pip3 install --break-system-packages kokoro-onnx \
  && rm -rf /var/lib/apt/lists/*

# Download Kokoro TTS model files
RUN mkdir -p /app/models_kokoro \
  && curl -fL "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.fp16.onnx" -o /app/models_kokoro/kokoro-v1.0.fp16.onnx \
  && curl -fL "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" -o /app/models_kokoro/voices-v1.0.bin

WORKDIR /app

COPY package.json package-lock.json ./
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
