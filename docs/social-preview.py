#!/usr/bin/env python3
"""
Produces `social-preview.png`, the 1280x640 card GitHub renders when somebody
shares a link to the repository. It uses the top of `overview.png`, so run it
again after that screenshot changes.

Needs Pillow and the SF fonts that ship with macOS.

    python3 -m pip install --user pillow
    python3 docs/social-preview.py

Upload the result under Settings -> General -> Social preview. GitHub does not
read it from the repository.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

HERE = pathlib.Path(__file__).parent

W, H = 1280, 640
GROUND, PANEL, LINE = (11, 13, 18), (17, 20, 27), (42, 48, 64)
INK, SOFT, QUIET = (233, 236, 242), (200, 206, 217), (110, 118, 135)
AMBER, HEALTHY = (245, 165, 36), (61, 214, 140)

SFNS = "/System/Library/Fonts/SFNS.ttf"
SFMONO = "/System/Library/Fonts/SFNSMono.ttf"


def variable(path, size, name=None):
    font = ImageFont.truetype(path, size)
    if name:
        font.set_variation_by_name(name)
    return font


def main():
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 5], fill=AMBER)

    title = variable(SFNS, 96, "Bold")
    sub = variable(SFNS, 40, "Medium")
    body = ImageFont.truetype(SFNS, 27)
    mono = ImageFont.truetype(SFMONO, 22)

    x = 96
    d.ellipse([x, 130, x + 22, 152], fill=AMBER)
    d.text((x + 36, 124), "needs attention", font=mono, fill=AMBER)
    d.text((x, 196), "Estate", font=title, fill=INK)
    d.text((x, 312), "One live page per service", font=sub, fill=QUIET)
    for i, line in enumerate([
        "Alerts, metrics, deploys, builds, logs and",
        "costs from the tools you already run, with",
        "links back to each.",
    ]):
        d.text((x, 398 + 38 * i), line, font=body, fill=SOFT)
    footer = "TypeScript  ·  Effect  ·  Solid"
    assert x + d.textlength(footer, font=mono) < 600
    d.text((x, 560), footer, font=mono, fill=HEALTHY)

    # The page itself: the top of the overview screenshot, in a frame.
    shot = Image.open(HERE / "overview.png").convert("RGB")
    crop = shot.crop((0, 0, 1440, 880))
    px0, px1 = 624, 1184
    pw = px1 - px0
    ph = round(pw * crop.height / crop.width)
    py0 = (H - ph) // 2
    crop = crop.resize((pw, ph), Image.LANCZOS)
    d.rounded_rectangle([px0 - 1, py0 - 1, px1, py0 + ph], radius=12, outline=LINE, width=1)
    mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=12, fill=255)
    img.paste(crop, (px0, py0), mask)

    out = HERE / "social-preview.png"
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({W}x{H})")


if __name__ == "__main__":
    main()
