#!/bin/bash
set -e

MODEL_DIR="models_kokoro"
BASE_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

echo "==> Installing Python dependencies ..."
pip3 install --break-system-packages kokoro-onnx 2>&1 | tail -1

echo ""
echo "==> Downloading Kokoro TTS model files to $MODEL_DIR ..."
mkdir -p "$MODEL_DIR"

echo "    kokoro-v1.0.fp16.onnx (169 MB — this may take a moment)"
curl -fL "$BASE_URL/kokoro-v1.0.fp16.onnx" -o "$MODEL_DIR/kokoro-v1.0.fp16.onnx" --progress-bar

echo "    voices-v1.0.bin"
curl -fL "$BASE_URL/voices-v1.0.bin" -o "$MODEL_DIR/voices-v1.0.bin" --progress-bar

echo ""
echo "=> Kokoro setup complete."
du -sh "$MODEL_DIR"
