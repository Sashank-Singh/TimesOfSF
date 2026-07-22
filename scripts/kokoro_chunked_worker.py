"""Persistent Kokoro chunked TTS worker.

Keeps the ONNX model warm in memory. Each stdin JSON line is one request;
stdout streams NDJSON PCM chunks, then a binary end marker so Node can
demultiplex jobs.

Protocol:
  stdin:  {"text":"hello world"}\n
  stdout: {"sampleRate":24000,"channels":1}\n
          {"pcm":"<base64_int16>"}\n
          ...
          {"done":true}\n
          ---END---\n
"""

from __future__ import annotations

import base64
import json
import re
import sys
import textwrap
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

VOICE = "af_heart"
SAMPLE_RATE = 24000
# Keep the opening chunk tiny so time-to-first-audio stays under ~5s on warm model.
FIRST_CHUNK_MAX = 48
CHUNK_MAX_CHARS = 90
END_MARKER = b"\n---END---\n"

SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = SCRIPT_DIR.parent / "models_kokoro"

_kokoro: Kokoro | None = None


def get_kokoro() -> Kokoro:
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    model_path = MODEL_DIR / "kokoro-v1.0.fp16.onnx"
    voices_path = MODEL_DIR / "voices-v1.0.bin"
    if not model_path.exists() or not voices_path.exists():
        sys.stderr.write(f"Kokoro model missing under {MODEL_DIR}\n")
        sys.stderr.flush()
        sys.exit(1)
    sys.stderr.write("[kokoro-chunked-worker] loading model...\n")
    sys.stderr.flush()
    _kokoro = Kokoro(str(model_path), str(voices_path))
    sys.stderr.write("[kokoro-chunked-worker] model ready\n")
    sys.stderr.flush()
    return _kokoro


def split_into_chunks(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        limit = FIRST_CHUNK_MAX if not chunks else CHUNK_MAX_CHARS
        if len(s) <= limit:
            if chunks and len(chunks[-1]) + len(s) + 1 <= CHUNK_MAX_CHARS:
                chunks[-1] += " " + s
            else:
                chunks.append(s)
            continue
        parts = re.split(r"(?<=[,;:])\s+", s)
        for p in parts:
            p = p.strip()
            if not p:
                continue
            lim = FIRST_CHUNK_MAX if not chunks else CHUNK_MAX_CHARS
            if len(p) <= lim:
                if chunks and len(chunks[-1]) + len(p) + 1 <= CHUNK_MAX_CHARS:
                    chunks[-1] += " " + p
                else:
                    chunks.append(p)
            else:
                # Force a short opener, then wrap the rest.
                if not chunks:
                    chunks.append(p[:FIRST_CHUNK_MAX].rsplit(" ", 1)[0] or p[:FIRST_CHUNK_MAX])
                    rest = p[len(chunks[-1]):].lstrip()
                    if rest:
                        chunks.extend(textwrap.wrap(rest, CHUNK_MAX_CHARS))
                else:
                    chunks.extend(textwrap.wrap(p, CHUNK_MAX_CHARS))
    return chunks or [text[:FIRST_CHUNK_MAX]]


def emit_line(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle_request(text: str) -> None:
    kokoro = get_kokoro()
    # Tell the client the rate immediately so it can unlock/prepare audio.
    emit_line({"sampleRate": SAMPLE_RATE, "channels": 1})

    chunks = split_into_chunks(text.strip())
    emitted = 0
    for chunk in chunks:
        try:
            samples, sample_rate = kokoro.create(chunk, voice=VOICE)
        except Exception as exc:
            sys.stderr.write(f"Gen error: {exc}\n")
            sys.stderr.flush()
            continue
        rate = int(sample_rate) if sample_rate else SAMPLE_RATE
        if rate != SAMPLE_RATE and emitted == 0:
            # Correct rate if model disagrees (rare).
            emit_line({"sampleRate": rate, "channels": 1})
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        emit_line({"pcm": base64.b64encode(pcm).decode("ascii")})
        emitted += 1

    emit_line({"done": True})
    sys.stdout.buffer.write(END_MARKER)
    sys.stdout.buffer.flush()


def main() -> None:
    # Eager load so the first Listen click is warm.
    get_kokoro()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            text = (data.get("text") or "").strip()
            if not text:
                emit_line({"error": "Missing text"})
                sys.stdout.buffer.write(END_MARKER)
                sys.stdout.buffer.flush()
                continue
            handle_request(text)
        except Exception as exc:
            sys.stderr.write(f"Worker error: {exc}\n")
            sys.stderr.flush()
            try:
                emit_line({"error": str(exc)})
                sys.stdout.buffer.write(END_MARKER)
                sys.stdout.buffer.flush()
            except Exception:
                pass


if __name__ == "__main__":
    main()
