fn main() {
    let root = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    cc::Build::new()
        .file("native/codecs.c")
        .file("native/scanlines.c")
        .include(format!("{root}/.build/install/include"))
        .define("SPNG_STATIC", None)
        .flag("-msimd128")
        .compile("image_bridge");
    println!("cargo:rustc-link-search=native={root}/.build/install/lib");
    for lib in ["turbojpeg", "jpeg", "spng", "webp", "sharpyuv"] {
        println!("cargo:rustc-link-lib=static={lib}");
    }
    println!("cargo:rustc-link-arg=-sUSE_ZLIB=1");
    println!("cargo:rerun-if-changed=native/codecs.c");
    println!("cargo:rerun-if-changed=native/scanlines.c");
}
