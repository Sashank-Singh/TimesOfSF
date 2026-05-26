"""Server-side TTS via edge-tts.

Usage:
  python3 scripts/tts.py '{"text":"hello world","voice":"en-US-JennyNeural"}'
  -> MP3 audio written to stdout
"""
import json, sys, asyncio
from edge_tts import Communicate

VOICE = "en-US-JennyNeural"


async def stream_tts(text: str) -> None:
    """Stream TTS audio to stdout. edge-tts handles long text internally."""
    communicate = Communicate(text, VOICE)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
            sys.stdout.buffer.flush()


if __name__ == "__main__":
    input_data = json.loads(sys.argv[1])
    text = input_data.get("text", "")
    if not text:
        sys.stderr.write("Missing text\n")
        sys.exit(1)
    asyncio.run(stream_tts(text))
