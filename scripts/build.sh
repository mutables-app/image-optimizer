#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${EMSDK:?Set EMSDK to an installed Emscripten 6.0.10 SDK}"
export PATH="$HOME/.cargo/bin:$EMSDK/upstream/emscripten:$PATH"
export EM_CONFIG="${EM_CONFIG:-$HOME/.cache/worker-build/emscripten-6.0.10.config}"
export CC_wasm32_unknown_emscripten="$EMSDK/upstream/emscripten/emcc"
export CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER="$EMSDK/upstream/emscripten/emcc"
export EMCC_CFLAGS='-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0'
export RUSTFLAGS='-Ctarget-feature=+simd128 -Cllvm-args=-wasm-use-legacy-eh=false -Clink-arg=-sBINARYEN_EXTRA_PASSES=--translate-to-exnref -Clink-arg=-sWASM_BINDGEN -Clink-arg=-sMODULARIZE=instance -Clink-arg=-sEXPORT_ES6 -Clink-arg=-sAUTO_INIT -Clink-arg=-sSOURCE_PHASE_IMPORTS -Clink-arg=-sENVIRONMENT=web,worker -Clink-arg=-sASSERTIONS=0 -Clink-arg=-sALLOW_MEMORY_GROWTH=1 -Clink-arg=-sMAXIMUM_MEMORY=268435456 -Clink-arg=-sSTACK_SIZE=1048576'
python3 scripts/build-native.py
cargo build --locked --release --target wasm32-unknown-emscripten -j2
python3 scripts/package.py
