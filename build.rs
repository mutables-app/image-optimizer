fn main() {
    let root = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    cc::Build::new()
        .file("native/codecs.c")
        .file("native/scanlines.c")
        .file("native/heif.cpp")
        .file(format!("{root}/.build/pngle/src/pngle.c"))
        .file(format!("{root}/.build/pngle/src/miniz.c"))
        .file(format!("{root}/.build/lowzag/src/lowzag.c"))
        .file(format!("{root}/.build/lowzag/src/lowzag_mem.c"))
        .include(format!("{root}/.build/install/include"))
        .include(format!("{root}/.build/pngle/src"))
        .include(format!("{root}/.build/lowzag/include"))
        .define("SPNG_STATIC", None)
        .flag("-msimd128")
        .compile("image_bridge");
    println!("cargo:rustc-link-search=native={root}/.build/install/lib");
    println!("cargo:rustc-link-search=native={root}/.build/install/lib");
    for lib in ["turbojpeg", "jpeg", "spng", "webp", "sharpyuv"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    println!("cargo:rustc-link-lib=static=heif");
    println!("cargo:rustc-link-lib=static=dav1d");
    println!("cargo:rustc-link-lib=static=de265");
    println!("cargo:rustc-link-lib=c++");
    println!("cargo:rustc-link-lib=c++abi");
    println!("cargo:rustc-link-arg=-sUSE_ZLIB=1");
    println!("cargo:rerun-if-changed=native/codecs.c");
    println!("cargo:rerun-if-changed=native/scanlines.c");
    println!("cargo:rerun-if-changed=native/heif.cpp");
    println!("cargo:rerun-if-changed=.build/pngle/src/pngle.c");
    println!("cargo:rerun-if-changed=.build/pngle/src/miniz.c");
    println!("cargo:rerun-if-changed=.build/pngle/src/pngle.h");
    println!("cargo:rerun-if-changed=.build/pngle/src/miniz.h");
    println!("cargo:rerun-if-changed=.build/lowzag/src/lowzag.c");
    println!("cargo:rerun-if-changed=.build/lowzag/src/lowzag_mem.c");
    println!("cargo:rerun-if-changed=.build/lowzag/include/lowzag.h");
}
