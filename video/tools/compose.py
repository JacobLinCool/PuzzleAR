"""Assembles the PuzzleAR demo: explainer clips + real-app footage + narration.

Scene i lasts L_i = lead + narration_i + pad_i. Clips overlap by a crossfade X,
so scene i starts at sum(L_<i) and its narration at start_i + lead.
Usage: python3 video/tools/compose.py
"""
import json
import os
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
B = os.path.join(ROOT, "video/build")
OUT = os.path.join(ROOT, "video/out")
FPS = 30
os.makedirs(os.path.join(B, "norm"), exist_ok=True)
os.makedirs(OUT, exist_ok=True)

sb = json.load(open(os.path.join(ROOT, "video/storyboard.json")))
LEAD, X = sb.get("lead", 0.8), sb.get("crossfade", 0.6)
man = json.load(open(os.path.join(B, "narration/manifest.json")))
marks = json.load(open(os.path.join(B, "app/marks.json")))


def run(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def tag_png(path):
    """Small 'real app' badge so viewers can tell footage from explainers."""
    W, H = 1920, 1080
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 26)
    except OSError:
        f = ImageFont.load_default()
    text = "Real app  ·  sample puzzle"
    tw = d.textlength(text, font=f)
    x, y, h = 32, H - 32 - 52, 52
    d.rounded_rectangle([x, y, x + tw + 64, y + h], radius=26, fill=(31, 42, 37, 220))
    d.ellipse([x + 22, y + h / 2 - 6, x + 34, y + h / 2 + 6], fill=(47, 179, 159, 255))
    d.text((x + 46, y + 11), text, font=f, fill=(255, 255, 255, 255))
    img.save(path)


tag = os.path.join(B, "norm/tag.png")
tag_png(tag)

scenes = sb["scenes"]
lengths = []
clips = []
for i, sc in enumerate(scenes):
    L = LEAD + man[sc["name"]]["duration_s"] + sc["pad"]
    lengths.append(L)
    need = L + (X if i < len(scenes) - 1 else 0)
    out = os.path.join(B, "norm", f"{sc['name']}.mp4")
    if sc["kind"] == "anim":
        run("-i", os.path.join(B, "clips", f"{sc['name']}.mp4"), "-t", f"{need:.3f}",
            "-vf", f"fps={FPS},scale=1920:1080,setsar=1,format=yuv420p",
            "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-an", out)
    else:
        start = marks[sc["name"]]
        run("-ss", f"{start:.3f}", "-t", f"{need:.3f}", "-i", os.path.join(B, "app/raw.webm"),
            "-loop", "1", "-t", f"{need:.3f}", "-i", tag,
            "-filter_complex",
            f"[0:v]fps={FPS},scale=1920:1080:flags=lanczos,setsar=1[v];"
            f"[1:v]format=rgba,fade=t=in:st=0.6:d=0.5:alpha=1[t];[v][t]overlay=0:0,format=yuv420p[o]",
            "-map", "[o]", "-t", f"{need:.3f}", "-c:v", "libx264", "-crf", "17", "-preset", "medium", out)
    clips.append(out)
    print(f"{sc['name']}: L={L:.2f}s")

# video: xfade chain
inputs = []
for c in clips:
    inputs += ["-i", c]
fc = ""
prev = "0:v"
offset = 0.0
for i in range(1, len(clips)):
    offset += lengths[i - 1]
    lab = f"x{i}"
    trans = "fadeblack" if scenes[i]["name"] == "v03_title" else "fade"
    fc += f"[{prev}][{i}:v]xfade=transition={trans}:duration={X}:offset={offset - 0:.3f}[{lab}];"
    prev = lab
total = sum(lengths)
fc += f"[{prev}]fade=t=in:st=0:d=0.6,fade=t=out:st={total - 1.0:.3f}:d=1.0,format=yuv420p[vout]"

# audio: narration at scene start + lead
starts = [sum(lengths[:i]) for i in range(len(lengths))]
ain = []
af = ""
for i, sc in enumerate(scenes):
    ain += ["-i", man[sc["name"]]["path"]]
    ms = int(round((starts[i] + LEAD) * 1000))
    af += f"[{len(clips) + i}:a]aresample=48000,adelay={ms}|{ms}[a{i}];"
af += "".join(f"[a{i}]" for i in range(len(scenes)))
af += f"amix=inputs={len(scenes)}:normalize=0,apad,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]"

final = os.path.join(OUT, "puzzlear-demo.mp4")
run(*inputs, *ain, "-filter_complex", fc + ";" + af, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-crf", "19", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", final)
json.dump({"starts": starts, "lengths": lengths, "total": total}, open(os.path.join(B, "timeline.json"), "w"), indent=1)
print(f"total {total:.2f}s -> {final}")
