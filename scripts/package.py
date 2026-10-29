import pathlib, re
root = pathlib.Path(__file__).resolve().parents[1]
build = root / 'target/wasm32-unknown-emscripten/release'
dist = root / 'packages/optimizer/dist'
dist.mkdir(exist_ok=True)
js = (build / 'workspace-image.js').read_text()
# Emscripten's source-phase import becomes the Workers static Wasm module import.
js, count = re.subn(r'import source (\w+) from\s*(["\'])[^"\']+\.wasm\2;', r'import \1 from "./optimizer.wasm";', js)
if count != 1: raise RuntimeError('Expected one Emscripten source-phase Wasm import')
(dist / 'optimizer.js').write_text(js)
node = re.sub(r'import (\w+) from "./optimizer.wasm";', r'import {readFileSync as __readWasm} from "node:fs"; const \1 = new WebAssembly.Module(__readWasm(new URL("./optimizer.wasm", import.meta.url)));', js)
(dist / 'optimizer.node.js').write_text(node)
(dist / 'optimizer.wasm').write_bytes((build / 'workspace_image.wasm').read_bytes())
print('Packaged standalone Worker and Node entrypoints:', dist)
