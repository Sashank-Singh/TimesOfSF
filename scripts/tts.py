"""Server-side TTS via edge-tts.

Usage:
  python3 scripts/tts.py '{"text":"hello world","voice":"en-US-JennyNeural"}'
  -> WAV audio written to stdout
"""
import json, sys, asyncio, io, wave, struct
import edge_tts
from edge_tts import Communicate

# Voices with known good quality
VOICES = {
    "en-US-JennyNeural": "English (US) — Jenny (female, natural)",
    "en-US-GuyNeural": "English (US) — Guy (male)",
    "en-US-AriaNeural": "English (US) — Aria (female)",
    "en-US-DavisNeural": "English (US) — Davis (male)",
    "en-GB-SoniaNeural": "English (UK) — Sonia (female)",
    "en-GB-RyanNeural": "English (UK) — Ryan (male)",
    "en-AU-NatashaNeural": "English (AU) — Natasha (female)",
    "en-IN-NeerjaNeural": "English (IN) — Neerja (female)",
}

MAX_CHARS = 3000


def chunk_text(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """Split text into chunks at sentence boundaries (never in the middle of a word)."""
    if len(text) <= max_chars:
        return [text]
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + max_chars, len(text))
        if end < len(text):
            # Find the last sentence boundary before max_chars
            boundary = max(
                text.rfind(". ", i, end),
                text.rfind("! ", i, end),
                text.rfind("? ", i, end),
                text.rfind("\n\n", i, end),
            )
            if boundary > i:
                end = boundary + 1
            else:
                # No sentence boundary found, break at word boundary
                boundary = text.rfind(" ", i, end)
                if boundary > i:
                    end = boundary
        chunks.append(text[i:end].strip())
        i = end
    return [c for c in chunks if c]


async def generate_tts(text: str, voice: str, output_path: str) -> None:
    """Generate TTS audio and save to output_path."""
    communicate = Communicate(text, voice)
    await communicate.save(output_path)


async def generate_tts_stdout(text: str, voice: str) -> None:
    """Generate TTS audio and write WAV to stdout."""
    output_path = "/tmp/tts-output.wav"
    await generate_tts(text, voice, output_path)
    with open(output_path, "rb") as f:
        sys.stdout.buffer.write(f.read())


async def generate_tts_streamed(text: str, voice: str) -> None:
    """Generate TTS audio for long text by chunking, writing concatenated WAV to stdout."""
    chunks = chunk_text(text)
    if len(chunks) == 1:
        await generate_tts_stdout(text, voice)
        return

    # Generate each chunk to a temp file, then concatenate
    audio_files: list[str] = []
    for i, chunk in enumerate(chunks):
        path = f"/tmp/tts-chunk-{i}.wav"
        await generate_tts(chunk, voice, path)
        audio_files.append(path)

    # Concatenate WAV files (simple: just concatenate PCM data after headers)
    combined = io.BytesIO()
    with wave.open(audio_files[0], "rb") as w0:
        params = w0.getparams()
        combined_data = w0.readframes(w0.getnframes())
    for path in audio_files[1:]:
        with wave.open(path, "rb") as w:
            combined_data += w.readframes(w.getnframes())

    with wave.open(combined, "wb") as out:
        out.setparams(params)
        out.writeframes(combined_data)

    sys.stdout.buffer.write(combined.getvalue())


if __name__ == "__main__":
    input_data = json.loads(sys.argv[1])
    text = input_data.get("text", "")
    voice = input_data.get("voice", "en-US-JennyNeural")
    if not text:
        sys.stderr.write("Missing text\n")
        sys.exit(1)
    if voice not in VOICES:
        voice = "en-US-JennyNeural"
    asyncio.run(generate_tts_streamed(text, voice))
