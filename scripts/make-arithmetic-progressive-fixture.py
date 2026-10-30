"""Generate a synthetic arithmetic-coded progressive JPEG fixture using cjpeg."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--cjpeg', default='cjpeg', help='path to libjpeg-turbo cjpeg')
parser.add_argument('--output', type=Path)
args = parser.parse_args()

width, height = 4000, 3000
root = Path(__file__).resolve().parents[1]
output = args.output or root / 'test/fixtures/input-12mp-arithmetic-progressive.jpg'
cjpeg = shutil.which(args.cjpeg) or args.cjpeg

with tempfile.TemporaryDirectory(prefix='arithmetic-progressive-') as temp:
    ppm = Path(temp) / 'fixture.ppm'
    with ppm.open('wb') as image:
        image.write(f'P6\n{width} {height}\n255\n'.encode())
        for y in range(height):
            row = bytearray(width * 3)
            for x in range(width):
                i = 3 * x
                row[i] = (x // 32 * 29 + y // 32 * 17) & 255
                row[i + 1] = (x // 16 * 11 + y // 48 * 31) & 255
                row[i + 2] = (x ^ y) & 255
            image.write(row)
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        cjpeg, '-arithmetic', '-progressive', '-quality', '80',
        '-sample', '2x2,1x1,1x1', '-outfile', str(output), str(ppm),
    ], check=True)
print(f'Wrote {output} ({width}x{height}, {output.stat().st_size} bytes)')
