#!/usr/bin/env python3
"""
Record the crew's lines as voice clips with Piper, an open-source neural text-to-speech engine.

    pip install piper-tts
    python3 scripts/voices.py            # writes public/voice/<id>.mp3 and public/voice/index.json

Reads src/audio/lines.json (the same list the game uses). The captain's cabin announcements use a
calm, deep British male voice; the cockpit callouts a crisper one. Needs ffmpeg and internet access
to huggingface.co the first time (the voice models are cached in ~/.cache/piper-voices).
"""
import json
import subprocess
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES = ROOT / "src" / "audio" / "lines.json"
OUT = ROOT / "public" / "voice"
CACHE = Path.home() / ".cache" / "piper-voices"
BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

# kind -> (voice, speaking rate: >1 is slower, sentence pause in seconds)
VOICES = {
    "pa": ("en/en_GB/alan/medium/en_GB-alan-medium", 1.12, 0.45),
    "callout": ("en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium", 0.95, 0.2),
}


def model(path: str) -> Path:
    """Download a Piper voice (model + config) once."""
    CACHE.mkdir(parents=True, exist_ok=True)
    name = path.rsplit("/", 1)[-1]
    onnx = CACHE / f"{name}.onnx"
    for suffix in (".onnx", ".onnx.json"):
        target = CACHE / f"{name}{suffix}"
        if not target.exists():
            print(f"  downloading {name}{suffix}")
            urllib.request.urlretrieve(f"{BASE}/{path}{suffix}", target)
    return onnx


def main() -> None:
    from piper import PiperVoice, SynthesisConfig  # pip install piper-tts

    lines = json.loads(LINES.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    voices = {kind: (PiperVoice.load(str(model(path))), rate, pause) for kind, (path, rate, pause) in VOICES.items()}
    done = []
    for line in lines:
        voice, rate, pause = voices[line["kind"]]
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "line.wav"
            with wave.open(str(wav), "wb") as w:
                voice.synthesize_wav(line["text"], w, syn_config=SynthesisConfig(length_scale=rate, noise_scale=0.6, noise_w_scale=0.7))
            mp3 = OUT / f"{line['id']}.mp3"
            # Trim silence, add a short sentence breath, normalise loudness, mono 64 kbps.
            subprocess.run(
                [
                    "ffmpeg", "-loglevel", "error", "-y", "-i", str(wav),
                    "-af", f"silenceremove=start_periods=1:start_threshold=-50dB,apad=pad_dur={pause},loudnorm=I=-17:TP=-2",
                    "-ac", "1", "-ar", "24000", "-b:a", "64k", str(mp3),
                ],
                check=True,
            )
        done.append(line["id"])
        print(f"  {line['id']}: {line['text'][:60]}")
    (OUT / "index.json").write_text(json.dumps(done) + "\n")
    print(f"Wrote {len(done)} clips to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
