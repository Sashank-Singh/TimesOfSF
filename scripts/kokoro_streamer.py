"""One-shot Kokoro TTS streamer — outputs streaming WAV to stdout.

Generates text sentence-by-sentence and writes PCM data progressively so
the browser can start playback within seconds of the first sentence.

Usage:
  python3 scripts/kokoro_streamer.py <text>
  -> streaming WAV audio on stdout (header first, then PCM data)

The WAV header uses unknown-size markers (0x7FFFFFFF) so playback can
begin before the entire file is generated.
"""

import sys
import os
import re
import struct
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

VOICE = "af_heart"
SAMPLE_RATE = 24000
CHUNK_MAX_CHARS = 150

SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = SCRIPT_DIR.parent / "models_kokoro"


def write_wav_header() -> bytes:
    header = bytearray()
    header += b"RIFF"
    header += struct.pack("<I", 0x7FFFFFFF)  # file size (unknown while streaming)
    header += b"WAVE"
    header += b"fmt "
    header += struct.pack("<I", 16)  # chunk size
    header += struct.pack("<H", 1)  # PCM
    header += struct.pack("<H", 1)  # mono
    header += struct.pack("<I", SAMPLE_RATE)
    header += struct.pack("<I", SAMPLE_RATE * 2)  # byte rate
    header += struct.pack("<H", 2)  # block align
    header += struct.pack("<H", 16)  # bits per sample
    header += b"data"
    header += struct.pack("<I", 0x7FFFFFFF)  # data size (unknown)
    return bytes(header)


def split_into_chunks(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list[str]:
    """Split text at sentence boundaries, keeping chunks under max_chars."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    buf = ""
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(buf) + len(s) + 1 > max_chars and buf:
            chunks.append(buf)
            buf = s
        else:
            buf = (buf + " " + s).strip()
    if buf:
        chunks.append(buf)
    return chunks or [text]


def main() -> None:
    raw_text = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    text = raw_text.strip()
    if not text:
        sys.stderr.write("No text provided\n")
        sys.exit(1)

    model_path = MODEL_DIR / "kokoro-v1.0.fp16.onnx"
    voices_path = MODEL_DIR / "voices-v1.0.bin"

    try:
        kokoro = Kokoro(str(model_path), str(voices_path))
    except Exception as exc:
        sys.stderr.write(f"Failed to load Kokoro model: {exc}\n")
        sys.exit(1)

    chunks = split_into_chunks(text)

    header_written = False
    for chunk in chunks:
        try:
            samples, sample_rate = kokoro.create(chunk, voice=VOICE)
        except Exception as exc:
            sys.stderr.write(f"Generation error for chunk: {exc}\n")
            continue

        if not header_written:
            sys.stdout.buffer.write(write_wav_header())
            header_written = True

        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        sys.stdout.buffer.write(pcm)
        sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
