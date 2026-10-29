# Independent native JPEG/WebP decoding for pixel comparisons. CI installs
# python3-pil; a local Python environment with Pillow works as well.
import base64, io, json, sys
from PIL import Image
im = Image.open(io.BytesIO(sys.stdin.buffer.read()))
im.load()
print(json.dumps({'width':im.width, 'height':im.height, 'format':im.format,
                  'progressive':bool(im.info.get('progressive', False)),
                  'pixels':base64.b64encode(im.convert('RGBA').tobytes()).decode()}))
