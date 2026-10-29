#!/usr/bin/env python3
"""Fetch pinned codec releases and build static Emscripten libraries."""
import os, pathlib, subprocess, tarfile, urllib.request, shutil
root = pathlib.Path(__file__).resolve().parents[1]
cache = root / '.build'
prefix = cache / 'install'
cache.mkdir(exist_ok=True)
cmake = os.environ.get('CMAKE', 'cmake')
em = pathlib.Path(os.environ['EMSDK']) / 'upstream/emscripten'
def run(*args): subprocess.run([str(a) for a in args], check=True)
for name, tag, repo, extra in [
    ('jpeg', '3.1.3', 'libjpeg-turbo/libjpeg-turbo', ['-DENABLE_SHARED=OFF', '-DWITH_SIMD=OFF', '-DWITH_TOOLS=OFF', '-DWITH_TESTS=OFF']),
    ('webp', 'v1.6.0', 'webmproject/libwebp', ['-DBUILD_SHARED_LIBS=OFF', '-DWEBP_BUILD_ANIM_UTILS=OFF', '-DWEBP_BUILD_CWEBP=OFF', '-DWEBP_BUILD_DWEBP=OFF', '-DWEBP_BUILD_GIF2WEBP=OFF', '-DWEBP_BUILD_IMG2WEBP=OFF', '-DWEBP_BUILD_VWEBP=OFF', '-DWEBP_BUILD_WEBPINFO=OFF', '-DWEBP_BUILD_WEBPMUX=OFF', '-DWEBP_BUILD_EXTRAS=OFF']),
    ('spng', 'v0.7.4', 'randy408/libspng', []),
]:
    source = cache / name
    if not source.exists():
        archive = cache / (name + '.tar.gz')
        urllib.request.urlretrieve(f'https://codeload.github.com/{repo}/tar.gz/refs/tags/{tag}', archive)
        unpack = cache / (name + '-unpack'); unpack.mkdir(exist_ok=True)
        with tarfile.open(archive) as f: f.extractall(unpack, filter='data')
        next(unpack.iterdir()).rename(source)
        unpack.rmdir(); archive.unlink()
    if name == 'spng':
        (prefix / 'include').mkdir(parents=True, exist_ok=True)
        shutil.copy(source / 'spng/spng.h', prefix / 'include')
        run(em / 'emcc', '-O3', '-msimd128', '-sUSE_ZLIB=1', '-DSPNG_STATIC', '-c', source / 'spng/spng.c', '-o', cache / 'spng.o')
        run(em / 'emar', 'rcs', prefix / 'lib/libspng.a', cache / 'spng.o')
    else:
        run(cmake, '-S', source, '-B', cache / (name + '-build'), f'-DCMAKE_TOOLCHAIN_FILE={em}/cmake/Modules/Platform/Emscripten.cmake', f'-DCMAKE_INSTALL_PREFIX={prefix}', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-O3 -msimd128 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0', *extra)
        run(cmake, '--build', cache / (name + '-build'), '-j2')
        run(cmake, '--install', cache / (name + '-build'))
