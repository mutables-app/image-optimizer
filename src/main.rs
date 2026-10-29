use fast_image_resize::{images::Image, PixelType, ResizeOptions, Resizer};
use wasm_bindgen::prelude::*;
fn main() {}
struct DecodedPixels(*mut u8);
impl Drop for DecodedPixels { fn drop(&mut self) { unsafe { release_pixels(self.0) } } }
unsafe extern "C" {
    fn decode_image(data: *const u8, size: usize, max: u32, tw: u32, th: u32, scaled: i32,
                    pixels: *mut *mut u8, w: *mut u32, h: *mut u32) -> i32;
    fn jpeg_dimensions(data: *const u8, size: usize, w: *mut u32, h: *mut u32) -> i32;
    fn release_pixels(pixels: *mut u8);
    fn encode_webp(pixels: *const u8, w: u32, h: u32, quality: f32, lossless: i32, method: i32, output: *mut *mut u8) -> usize;
    fn release_webp(output: *mut u8);
}
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn host_now() -> f64;
}
fn error(message: &str) -> JsValue { JsValue::from_str(message) }
fn destination(w: u32, h: u32, width: u32, height: u32, inside: bool, no_enlargement: bool) -> (u32, u32) {
    let (mut ow, mut oh) = (width, height);
    if ow == 0 && oh == 0 { ow = w; oh = h; }
    else if ow == 0 { ow = ((w as f64 * oh as f64 / h as f64).round() as u32).max(1); }
    else if oh == 0 { oh = ((h as f64 * ow as f64 / w as f64).round() as u32).max(1); }
    else if inside {
        let scale = (ow as f64 / w as f64).min(oh as f64 / h as f64);
        ow = ((w as f64 * scale).round() as u32).max(1);
        oh = ((h as f64 * scale).round() as u32).max(1);
    }
    if no_enlargement {
        let scale = (w as f64 / ow as f64).min(h as f64 / oh as f64).min(1.0);
        ow = ((ow as f64 * scale).round() as u32).max(1);
        oh = ((oh as f64 * scale).round() as u32).max(1);
    }
    (ow, oh)
}
#[wasm_bindgen]
pub struct ExperimentResult {
    bytes: Vec<u8>,
    stages: Vec<f64>,
    pub decoded_width: u32,
    pub decoded_height: u32,
    pub output_width: u32,
    pub output_height: u32,
}
#[wasm_bindgen]
impl ExperimentResult {
    /// Host wall-clock durations: decode, decoded-buffer copy, resize, encode,
    /// encoded-buffer copy. Meaningful in Node; frozen on deployed Workers.
    pub fn stages_ms(&self) -> Vec<f64> { self.stages.clone() }
    pub fn take_bytes(self) -> Vec<u8> { self.bytes }
}
#[wasm_bindgen]
pub fn optimize(input: &[u8], width: u32, height: u32, inside: bool,
                without_enlargement: bool, quality: f32, lossless: bool, max_pixels: u32,
                method: i32, scaled: bool) -> Result<Vec<u8>, JsValue> {
    Ok(run(input, width, height, inside, without_enlargement, quality, lossless, max_pixels, scaled, method, false)?.bytes)
}
/// Experimental low-level API; production defaults remain unchanged.
#[wasm_bindgen]
pub fn experiment(input: &[u8], width: u32, height: u32, inside: bool,
                  without_enlargement: bool, quality: f32, lossless: bool,
                  max_pixels: u32, scaled: bool, method: i32, profile: bool) -> Result<ExperimentResult, JsValue> {
    run(input, width, height, inside, without_enlargement, quality, lossless, max_pixels, scaled, method, profile)
}
fn run(input: &[u8], width: u32, height: u32, inside: bool,
       without_enlargement: bool, quality: f32, lossless: bool, max_pixels: u32,
       scaled: bool, method: i32, profile: bool) -> Result<ExperimentResult, JsValue> {
    if input.is_empty() || input.len() > 20 * 1024 * 1024 { return Err(error("Input must be 1 byte–20 MiB")); }
    if !quality.is_finite() || quality < 0.0 || quality > 100.0 { return Err(error("Quality must be 0–100")); }
    if method < -1 || method > 6 { return Err(error("WebP method must be -1 (default) or 0–6")); }
    if max_pixels == 0 || max_pixels > 16_000_000 || width > 16383 || height > 16383 { return Err(error("Invalid image limits")); }
    let clock = || if profile { host_now() } else { 0.0 };
    let t0 = clock();
    let (mut original_w, mut original_h) = (0, 0);
    let (mut tw, mut th) = (0, 0);
    if scaled && input.starts_with(&[0xff, 0xd8]) {
        let status = unsafe { jpeg_dimensions(input.as_ptr(), input.len(), &mut original_w, &mut original_h) };
        if status != 0 { return Err(error("Image decode failed")); }
        (tw, th) = destination(original_w, original_h, width, height, inside, without_enlargement);
    }
    let (mut pixels, mut w, mut h) = (std::ptr::null_mut(), 0, 0);
    let status = unsafe { decode_image(input.as_ptr(), input.len(), max_pixels, tw, th, (scaled && !lossless) as i32, &mut pixels, &mut w, &mut h) };
    if status != 0 { return Err(error(match status { 2 => "Image exceeds pixel or dimension limit", 3 => "Image allocation failed", 4 => "Expected JPEG or PNG input", _ => "Image decode failed" })); }
    let t1 = clock();
    // Keep the decoder allocation alive and let the resizer borrow it. This
    // avoids a full-frame RGBA allocation and copy for large inputs.
    let decoded = DecodedPixels(pixels);
    let t2 = clock();
    if original_w == 0 { original_w = w; original_h = h; }
    let (ow, oh) = destination(original_w, original_h, width, height, inside, without_enlargement);
    if ow > 16383 || oh > 16383 || ow as u64 * oh as u64 > max_pixels as u64 { return Err(error("Output exceeds pixel or dimension limit")); }
    let (result, t3, t4, t5) = {
        let rgba = unsafe { std::slice::from_raw_parts_mut(decoded.0, w as usize * h as usize * 4) };
        let source = Image::from_slice_u8(w, h, rgba, PixelType::U8x4).map_err(|_| error("Invalid pixel buffer"))?;
        let resized;
        let rgba = if ow != w || oh != h {
            let mut destination = Image::new(ow, oh, PixelType::U8x4);
            Resizer::new().resize(&source, &mut destination, &ResizeOptions::new()).map_err(|_| error("Resize failed"))?;
            resized = destination; resized.buffer()
        } else { source.buffer() };
        let t3 = clock();
        let mut output = std::ptr::null_mut();
        let len = unsafe { encode_webp(rgba.as_ptr(), ow, oh, quality, lossless as i32, method, &mut output) };
        if len == 0 || output.is_null() { return Err(error("WebP encode failed")); }
        let t4 = clock();
        let data = unsafe { let data = std::slice::from_raw_parts(output, len).to_vec(); release_webp(output); data };
        let t5 = clock();
        (data, t3, t4, t5)
    };
    Ok(ExperimentResult {bytes: result, stages: if profile { vec![t1-t0,t2-t1,t3-t2,t4-t3,t5-t4] } else { Vec::new() },decoded_width: w,decoded_height: h,output_width: ow,output_height: oh})
}
