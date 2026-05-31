"""Persistent Kokoro TTS worker — reads JSON requests from stdin, writes WAV to stdout.

Uses the kokoro-onnx package for local TTS inference (no cloud API needed).
Same protocol as the edge-tts worker it replaces.

Protocol:
   stdin:  {"text":"hello","voice":"af_heart"}\n  (voice is optional)
   stdout: <binary WAV data>...\n---END---\n
"""

import json
import sys
import io
import wave
from pathlib import Path

import numpy as np
from kokoro_onnx import Kokoro

DEFAULT_VOICE = "af_heart"
SAMPLE_RATE = 24000
END_MARKER = b"\n---END---\n"

_kokoro: Kokoro | None = None


def get_kokoro() -> Kokoro:
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    script_dir = Path(__file__).resolve().parent
    model_dir = script_dir.parent / "models_kokoro"
    model_path = model_dir / "kokoro-v1.0.fp16.onnx"
    voices_path = model_dir / "voices-v1.0.bin"
    if not model_path.exists():
        sys.stderr.write(f"Kokoro model not found at {model_path}\n")
        sys.stderr.write("Run scripts/setup-kokoro.sh first.\n")
        sys.stderr.flush()
        sys.exit(1)
    if not voices_path.exists():
        sys.stderr.write(f"Kokoro voices not found at {voices_path}\n")
        sys.stderr.write("Run scripts/setup-kokoro.sh first.\n")
        sys.stderr.flush()
        sys.exit(1)
    _kokoro = Kokoro(str(model_path), str(voices_path))
    return _kokoro


def float32_to_wav(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Convert float32 audio samples to 16-bit mono WAV bytes."""
    samples = np.clip(samples, -1.0, 1.0)
    int_samples = (samples * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int_samples.tobytes())
    return buf.getvalue()


def generate(text: str, voice: str | None = None) -> None:
    kokoro = get_kokoro()
    v = voice or DEFAULT_VOICE
    try:
        samples, sample_rate = kokoro.create(text, voice=v)
        wav_bytes = float32_to_wav(samples, sample_rate)
        sys.stdout.buffer.write(wav_bytes)
    except Exception as exc:
        sys.stderr.write(f"Kokoro generation error: {exc}\n")
        sys.stderr.flush()
        silence = np.zeros(sample_rate, dtype=np.float32)
        sys.stdout.buffer.write(float32_to_wav(silence))
    finally:
        sys.stdout.buffer.write(END_MARKER)
        sys.stdout.buffer.flush()


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            text = data.get("text", "")
            voice = data.get("voice")
            if not text:
                sys.stderr.write("Missing text in request\n")
                sys.stderr.flush()
                continue
            generate(text, voice)
        except Exception as exc:
            sys.stderr.write(f"Worker error: {exc}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
