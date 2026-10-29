"""Generate small original JPEG fixtures (requires Pillow)."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]/'test/fixtures'
im=Image.new('RGB',(97,65))
im.putdata([((x*13+y*2)%256,(x*3+y*11)%256,(x*7+y*5)%256) for y in range(65) for x in range(97)])
im.save(root/'rows-baseline.jpg',quality=92)
im.save(root/'rows-progressive.jpg',quality=92,progressive=True)
im.convert('CMYK').save(root/'rows-cmyk.jpg',quality=92)
im.convert('L').save(root/'rows-gray.jpg',quality=92)
