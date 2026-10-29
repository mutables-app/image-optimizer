"""Generate a synthetic progressive JPEG for decoder memory tests (Pillow)."""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, default=6000)
parser.add_argument('--height', type=int, default=4000)
parser.add_argument('--output', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / "test/fixtures"
size = (args.width, args.height)
if size[0] < 1 or size[1] < 1 or size[0] * size[1] > 32_000_000:
    raise SystemExit('Dimensions must describe 1–32 megapixels')
output = args.output or root / ('input-24mp-progressive.jpg' if size == (6000, 4000) else f'input-{size[0]}x{size[1]}-progressive.jpg')

# Multiscale synthetic texture exercises progressive coefficient storage without
# adding a third-party photograph or nondeterministic source asset to the repo.
noise = Image.effect_noise((1500, 1000), 28).resize(size, Image.Resampling.BICUBIC)
base = Image.linear_gradient("L").resize(size).rotate(90, expand=True).crop((0, 0, *size))
image = Image.merge("RGB", (base, noise, Image.eval(noise, lambda p: min(255, p + 24))))
draw = ImageDraw.Draw(image)
for x in range(0, size[0], 240):
    draw.line((x, 0, size[0] - x, size[1]), fill=(40, 140, 210), width=3)
image = image.filter(ImageFilter.GaussianBlur(0.25))
image.save(output, quality=82, progressive=True, optimize=True)
print(f"Wrote {output} ({size[0]}x{size[1]}, {output.stat().st_size} bytes)")
