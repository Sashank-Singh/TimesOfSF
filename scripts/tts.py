"""Server-side TTS via edge-tts.

Usage:
  python3 scripts/tts.py '{"text":"hello world","voice":"en-US-JennyNeural"}'
  -> MP3 audio written to stdout
"""
import json, sys, asyncio
from edge_tts import Communicate

VOICE = "en-US-JennyNeural"
RATE = "+18%"


async def stream_tts(text: str, voice: str, rate: str) -> None:
    """Stream TTS audio to stdout. edge-tts handles long text internally."""
    communicate = Communicate(text, voice, rate=rate)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    input_data = json.loads(sys.argv[1])
    text = input_data.get("text", "")
    voice = input_data.get("voice") or VOICE
    rate = input_data.get("rate") or RATE
    if not text:
        sys.stderr.write("Missing text\n")
        sys.exit(1)
    asyncio.run(stream_tts(text, voice, rate))
