"""Server-side TTS via edge-tts.

Usage:
  python3 scripts/tts.py '{"text":"hello world","voice":"en-US-JennyNeural"}'
  -> MP3 audio written to stdout
"""
import json, sys, asyncio
from edge_tts import Communicate

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


async def stream_tts(text: str, voice: str) -> None:
    """Stream TTS audio to stdout. edge-tts handles long text internally."""
    communicate = Communicate(text, voice)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    input_data = json.loads(sys.argv[1])
    text = input_data.get("text", "")
    voice = input_data.get("voice", "en-US-JennyNeural")
    if not text:
        sys.stderr.write("Missing text\n")
        sys.exit(1)
    if voice not in VOICES:
        voice = "en-US-JennyNeural"
    asyncio.run(stream_tts(text, voice))
