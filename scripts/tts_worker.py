"""Persistent TTS worker — reads JSON requests from stdin, writes MP3 to stdout.

Keeps edge-tts import cached across requests. Each request is one JSON line
on stdin. Responses are: binary audio data, then "\n---END---\n" marker on
stdout. Stderr is for errors only.

Protocol:
   stdin:  {"text":"hello"}\n
   stdout: <binary MP3 chunks>...\n---END---\n
"""
import json, sys, asyncio
from edge_tts import Communicate

VOICE = "en-US-JennyNeural"
END_MARKER = b"\n---END---\n"


async def generate(text: str) -> None:
    communicate = Communicate(text, VOICE)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            sys.stdout.buffer.write(chunk["data"])
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
            if not text:
                sys.stderr.write("Missing text\n")
                sys.stderr.flush()
                continue
            asyncio.run(generate(text))
        except Exception as exc:
            sys.stderr.write(f"Error: {exc}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
