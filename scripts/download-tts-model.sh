#!/bin/bash
set -e
MODEL_DIR="${1:-models}"
BASE_URL="https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main"

mkdir -p "$MODEL_DIR/onnx" "$MODEL_DIR/voices"

echo "Downloading Kokoro-82M TTS model files to $MODEL_DIR ..."

curl -sfL "$BASE_URL/config.json" -o "$MODEL_DIR/config.json"
curl -sfL "$BASE_URL/tokenizer.json" -o "$MODEL_DIR/tokenizer.json"
curl -sfL "$BASE_URL/tokenizer_config.json" -o "$MODEL_DIR/tokenizer_config.json"

# Quantized model weights (88 MB)
curl -sfL "$BASE_URL/onnx/model_quantized.onnx" -o "$MODEL_DIR/onnx/model_quantized.onnx"

# All voice files (~510 KB each)
for voice in \
  af.bin af_alloy.bin af_aoede.bin af_bella.bin af_heart.bin af_jessica.bin \
  af_kore.bin af_nicole.bin af_nova.bin af_river.bin af_sarah.bin af_sky.bin \
  am_adam.bin am_echo.bin am_eric.bin am_fenrir.bin am_liam.bin am_michael.bin \
  am_onyx.bin am_puck.bin am_santa.bin \
  bf_alice.bin bf_emma.bin bf_isabella.bin bf_lily.bin \
  bm_daniel.bin bm_fable.bin bm_george.bin bm_lewis.bin \
  ef_dora.bin em_alex.bin em_santa.bin ff_siwis.bin \
  hf_alpha.bin hf_beta.bin hm_omega.bin hm_psi.bin \
  if_sara.bin im_nicola.bin \
  jf_alpha.bin jf_gongitsune.bin jf_nezumi.bin jf_tebukuro.bin jm_kumo.bin \
  pf_dora.bin pm_alex.bin pm_santa.bin \
  zf_xiaobei.bin zf_xiaoni.bin zf_xiaoxiao.bin zf_xiaoyi.bin \
  zm_yunjian.bin zm_yunxi.bin zm_yunxia.bin zm_yunyang.bin; do
  curl -sfL "$BASE_URL/voices/$voice" -o "$MODEL_DIR/voices/$voice"
done

echo "TTS model download complete."
du -sh "$MODEL_DIR"
