"""Per-sentence Kokoro TTS → base64 PCM chunks as NDJSON lines.

Usage:
  echo "<text>" | python3 scripts/kokoro_chunked.py
  -> NDJSON to stdout:
     {"sampleRate": 24000, "channels": 1}
     {"pcm": "<base64_int16>"}  (one per sentence chunk)
     {"done": true}

Fallback one-shot path used when the persistent worker is unavailable.
"""

import sys
import re
import base64
import textwrap
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

VOICE = "af_heart"
SAMPLE_RATE = 24000
CHUNK_MAX_CHARS = 80

SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = SCRIPT_DIR.parent / "models_kokoro"


def split_into_chunks(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) <= max_chars:
            if chunks and len(chunks[-1]) + len(s) + 1 <= max_chars:
                chunks[-1] += " " + s
            else:
                chunks.append(s)
        else:
            parts = re.split(r"(?<=[,;:])\s+", s)
            for p in parts:
                p = p.strip()
                if not p:
                    continue
                if len(p) <= max_chars:
                    if chunks and len(chunks[-1]) + len(p) + 1 <= max_chars:
                        chunks[-1] += " " + p
                    else:
                        chunks.append(p)
                else:
                    chunks.extend(textwrap.wrap(p, max_chars))
    return chunks or [text]


def main() -> None:
    raw_text = sys.stdin.read()
    text = raw_text.strip()
    if not text:
        sys.stderr.write("No text on stdin\n")
        sys.exit(1)

    # Advertise sample rate immediately so the client can prepare while the model loads.
    sys.stdout.write(f'{{"sampleRate": {SAMPLE_RATE}, "channels": 1}}\n')
    sys.stdout.flush()

    model_path = MODEL_DIR / "kokoro-v1.0.fp16.onnx"
    voices_path = MODEL_DIR / "voices-v1.0.bin"

    try:
        kokoro = Kokoro(str(model_path), str(voices_path))
    except Exception as exc:
        sys.stderr.write(f"Model load: {exc}\n")
        sys.stdout.write('{"error": "Model load failed"}\n')
        sys.stdout.write('{"done": true}\n')
        sys.stdout.flush()
        sys.exit(1)

    for chunk in split_into_chunks(text):
        try:
            samples, _sample_rate = kokoro.create(chunk, voice=VOICE)
        except Exception as exc:
            sys.stderr.write(f"Gen error: {exc}\n")
            sys.stderr.flush()
            continue

        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        b64 = base64.b64encode(pcm).decode("ascii")
        sys.stdout.write(f'{{"pcm": "{b64}"}}\n')
        sys.stdout.flush()

    sys.stdout.write('{"done": true}\n')
    sys.stdout.flush()


if __name__ == "__main__":
    main()
