"""Tempo-adjusts the narration (pitch preserved) and rescales its word timings.

Reads build/narration/manifest.tts.json (the TTS output, copied on first run)
and writes build/narration/manifest.json pointing at the adjusted audio.
Usage: python3 video/tools/speedup.py [factor]
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
N = os.path.join(ROOT, "video/build/narration")
factor = float(sys.argv[1]) if len(sys.argv) > 1 else float(json.load(open(os.path.join(ROOT, "video/storyboard.json"))).get("tempo", 1.0))
src = os.path.join(N, "manifest.tts.json")
if not os.path.exists(src):
    shutil.copy(os.path.join(N, "manifest.json"), src)
man = json.load(open(src))
os.makedirs(os.path.join(N, "fast"), exist_ok=True)
out = {}
for name, e in man.items():
    wav = os.path.join(N, "fast", f"{name}.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", e["path"], "-af", f"atempo={factor}", wav], check=True)
    out[name] = {
        **e,
        "path": wav,
        "duration_s": e["duration_s"] / factor,
        "words": [{**w, "start": w["start"] / factor, "end": w["end"] / factor} for w in e["words"]],
    }
json.dump(out, open(os.path.join(N, "manifest.json"), "w"), indent=2)
print(f"tempo x{factor}: {sum(e['duration_s'] for e in man.values()):.1f}s -> {sum(e['duration_s'] for e in out.values()):.1f}s")
