#!/usr/bin/env python3
"""Fetch pinned codec releases and build static Emscripten libraries."""
import os, pathlib, subprocess, tarfile, urllib.request, shutil
root = pathlib.Path(__file__).resolve().parents[1]
cache = root / '.build'
prefix = cache / 'install'
cache.mkdir(exist_ok=True)
cmake = os.environ.get('CMAKE', 'cmake')
em = pathlib.Path(os.environ['EMSDK']) / 'upstream/emscripten'
def run(*args, cwd=None, env=None): subprocess.run([str(a) for a in args], check=True, cwd=cwd, env=env)
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

# libheif provides HEIF/AVIF container parsing and color conversion. Its
# decoders are built in, without runtime plugins, for the Worker WASM module.
aom = cache / 'aom'
aom_source = cache / 'aom-source' / 'libaom-3.15.1'
if not (prefix / 'lib' / 'libaom.a').exists():
    source_root = cache / 'aom-source'
    source_root.mkdir(exist_ok=True)
    archive = cache / 'aom-3.15.1.tar.gz'
    if not archive.exists():
        urllib.request.urlretrieve('https://storage.googleapis.com/aom-releases/libaom-3.15.1.tar.gz', archive)
    with tarfile.open(archive) as f: f.extractall(source_root, filter='data')
    source = aom_source
    run(cmake, '-S', source, '-B', cache / 'aom-build', f'-DCMAKE_TOOLCHAIN_FILE={em}/cmake/Modules/Platform/Emscripten.cmake', f'-DCMAKE_INSTALL_PREFIX={prefix}', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0', '-DAOM_TARGET_CPU=generic', '-DENABLE_DOCS=OFF', '-DENABLE_TESTS=OFF', '-DENABLE_APPS=OFF', '-DENABLE_EXAMPLES=OFF', '-DENABLE_TESTDATA=OFF', '-DENABLE_TOOLS=OFF', '-DCONFIG_AV1_ENCODER=0', '-DCONFIG_AV1_DECODER=1', '-DCONFIG_MULTITHREAD=0', '-DCONFIG_RUNTIME_CPU_DETECT=0', '-DBUILD_SHARED_LIBS=OFF')
    run(cmake, '--build', cache / 'aom-build', '-j2')
    run(cmake, '--install', cache / 'aom-build')

de265 = cache / 'libde265'
if not (prefix / 'lib' / 'libde265.a').exists():
    archive = cache / 'libde265-1.1.3.tar.gz'
    if not archive.exists():
        urllib.request.urlretrieve('https://github.com/strukturag/libde265/releases/download/v1.1.3/libde265-1.1.3.tar.gz', archive)
    with tarfile.open(archive) as f: f.extractall(cache, filter='data')
    source = cache / 'libde265-1.1.3'
    run(cmake, '-S', source, '-B', cache / 'libde265-build', f'-DCMAKE_TOOLCHAIN_FILE={em}/cmake/Modules/Platform/Emscripten.cmake', f'-DCMAKE_INSTALL_PREFIX={prefix}', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DENABLE_SIMD=OFF', '-DENABLE_SDL=OFF', '-DENABLE_DECODER=ON', '-DENABLE_ENCODER=OFF', '-DENABLE_SHERLOCK265=OFF', '-DENABLE_INTERNAL_DEVELOPMENT_TOOLS=OFF', '-DWITH_FUZZERS=OFF', '-DCMAKE_CXX_FLAGS=-O3 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0')
    run(cmake, '--build', cache / 'libde265-build', '-j2')
    run(cmake, '--install', cache / 'libde265-build')

heif = cache / 'libheif-source'
if not heif.exists():
    archive = cache / 'libheif.tar.gz'
    urllib.request.urlretrieve('https://codeload.github.com/strukturag/libheif/tar.gz/refs/tags/v1.23.7', archive)
    unpack = cache / 'libheif-unpack'; unpack.mkdir(exist_ok=True)
    with tarfile.open(archive) as f: f.extractall(unpack, filter='data')
    next(unpack.iterdir()).rename(heif)
    shutil.rmtree(unpack); archive.unlink()
run(cmake, '-S', heif, '-B', cache / 'libheif-build', f'-DCMAKE_TOOLCHAIN_FILE={em}/cmake/Modules/Platform/Emscripten.cmake', f'-DCMAKE_INSTALL_PREFIX={prefix}', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_FLAGS=-D__EMSCRIPTEN_STANDALONE_WASM__=1', '-DCMAKE_CXX_FLAGS=-D__EMSCRIPTEN_STANDALONE_WASM__=1', '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_TESTING=OFF', '-DWITH_EXAMPLES=OFF', '-DENABLE_PLUGIN_LOADING=OFF', '-DENABLE_MULTITHREADING_SUPPORT=OFF', '-DWITH_AOM_DECODER=ON', '-DWITH_AOM_DECODER_PLUGIN=OFF', '-DWITH_AOM_ENCODER=OFF', '-DWITH_AOM_ENCODER_PLUGIN=OFF', '-DWITH_LIBDE265=ON', '-DWITH_LIBDE265_PLUGIN=OFF', f'-DAOM_INCLUDE_DIR={prefix}/include', f'-DAOM_LIBRARY={prefix}/lib/libaom.a', f'-DLIBDE265_INCLUDE_DIR={prefix}/include', f'-DLIBDE265_LIBRARY={prefix}/lib/libde265.a')
run(cmake, '--build', cache / 'libheif-build', '-j2')
run(cmake, '--install', cache / 'libheif-build')

licenses = root / 'packages' / 'optimizer' / 'licenses'
licenses.mkdir(exist_ok=True)
shutil.copy2(heif / 'COPYING', licenses / 'libheif-LICENSE')
shutil.copy2(cache / 'libde265-1.1.3' / 'COPYING', licenses / 'libde265-LICENSE')
shutil.copy2(aom_source / 'LICENSE', licenses / 'libaom-LICENSE')

# lowzag keeps only coefficients needed for reduced-scale progressive JPEG
# output. Pin the mirrored v2.3.0 commit rather than tracking its main branch.
lowzag = cache / 'lowzag'
if not lowzag.exists():
    archive = cache / 'lowzag.tar.gz'
    urllib.request.urlretrieve(
        'https://codeload.github.com/lowzag/lowzag/tar.gz/eab0b8811f4710a2a96dc4c72a4a5abcffc0a76a',
        archive,
    )
    unpack = cache / 'lowzag-unpack'; unpack.mkdir(exist_ok=True)
    with tarfile.open(archive) as f: f.extractall(unpack, filter='data')
    next(unpack.iterdir()).rename(lowzag)
    shutil.rmtree(unpack); archive.unlink()
shutil.copy2(lowzag / 'LICENSE', licenses / 'lowzag-LICENSE')
