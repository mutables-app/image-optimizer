//! Sequential decode and separable Lanczos3 resize. Downscaling scatters each
//! input row into a bounded set of active output rows; upscaling gathers from
//! a bounded cache. Neither case allocates a decoded source image in Rust.
use crate::{destination, error};
use std::{collections::VecDeque, ffi::c_void};
use wasm_bindgen::prelude::*;
unsafe extern "C" {
    fn rows_open(
        data: *const u8,
        size: usize,
        max_source: u32,
        out: *mut *mut c_void,
        w: *mut u32,
        h: *mut u32,
    ) -> i32;
    fn rows_start(ctx: *mut c_void, tw: u32, th: u32, scaled: i32, w: *mut u32, h: *mut u32)
        -> i32;
    fn rows_read(ctx: *mut c_void, row: *mut u8) -> i32;
    fn rows_finish(ctx: *mut c_void) -> i32;
    fn rows_close(ctx: *mut c_void);
    fn rows_buffered(ctx: *mut c_void) -> i32;
    fn rows_opaque(ctx: *mut c_void) -> i32;
}
struct Decoder(*mut c_void);
impl Drop for Decoder {
    fn drop(&mut self) {
        unsafe { rows_close(self.0) }
    }
}
fn check(status: i32) -> Result<(), JsValue> {
    if status == 0 {
        Ok(())
    } else {
        Err(error(match status {
            2 => "Image exceeds pixel or dimension limit",
            3 => "Image allocation failed",
            4 => "Expected JPEG or PNG input",
            _ => "Image decode failed",
        }))
    }
}
struct Kernel {
    start: usize,
    weights: Vec<f32>,
}
fn kernels(source: usize, target: usize) -> Vec<Kernel> {
    if source == target {
        return (0..source)
            .map(|start| Kernel {
                start,
                weights: vec![1.],
            })
            .collect();
    }
    let scale = source as f64 / target as f64;
    let support = scale.max(1.);
    (0..target)
        .map(|i| {
            let center = (i as f64 + 0.5) * scale;
            let start = (center - 3. * support).floor().max(0.) as usize;
            let end = ((center + 3. * support).ceil() as usize).min(source);
            let mut weights: Vec<f32> = (start..end)
                .map(|x| {
                    let v = ((x as f64 + 0.5 - center) / support).abs();
                    if v < 1e-12 {
                        1.
                    } else if v >= 3. {
                        0.
                    } else {
                        let p = v * std::f64::consts::PI;
                        (p.sin() / p * (p / 3.).sin() / (p / 3.)) as f32
                    }
                })
                .collect();
            let sum: f32 = weights.iter().sum();
            for weight in &mut weights {
                *weight /= sum;
            }
            Kernel { start, weights }
        })
        .collect()
}
// Four float channels per pixel also let the WASM implementation use SIMD128
// without rounding/clamping intermediate Lanczos values between passes.
#[inline]
fn add(dst: &mut [f32; 4], src: &[f32; 4], weight: f32) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        use std::arch::wasm32::*;
        let a = v128_load(dst.as_ptr().cast());
        let b = v128_load(src.as_ptr().cast());
        v128_store(
            dst.as_mut_ptr().cast(),
            f32x4_add(a, f32x4_mul(b, f32x4_splat(weight))),
        );
    }
    #[cfg(not(target_arch = "wasm32"))]
    for c in 0..4 {
        dst[c] += src[c] * weight;
    }
}
fn horizontal(row: &[u8], filters: &[Kernel], unchanged: bool) -> Vec<[f32; 4]> {
    let pixels: Vec<[f32; 4]> = row
        .chunks_exact(4)
        .map(|p| {
            let a = p[3] as f32 / 255.;
            [
                p[0] as f32 * a,
                p[1] as f32 * a,
                p[2] as f32 * a,
                p[3] as f32,
            ]
        })
        .collect();
    if unchanged {
        return pixels;
    }
    filters
        .iter()
        .map(|k| {
            let mut value = [0.; 4];
            for (p, &w) in pixels[k.start..k.start + k.weights.len()]
                .iter()
                .zip(&k.weights)
            {
                add(&mut value, p, w);
            }
            value
        })
        .collect()
}
fn emit(pixels: &[[f32; 4]], row: &mut [u8]) {
    for (p, q) in pixels.iter().zip(row.chunks_exact_mut(4)) {
        let a = p[3].clamp(0., 255.);
        q[3] = a.round() as u8;
        for c in 0..3 {
            q[c] = if q[3] == 0 {
                0
            } else {
                (p[c] * 255. / a).round().clamp(0., 255.) as u8
            };
        }
    }
}
#[derive(Default)]
pub struct Stats {
    pub source_width: u32,
    pub source_height: u32,
    pub decoded_width: u32,
    pub decoded_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub peak_row_bytes: usize,
    pub codec_buffered: bool,
    pub opaque_input: bool,
}
// Input remains buffered by the public API. `sink` is called once per output
// row, permitting a row encoder or a WebP destination buffer as the consumer.
pub fn resize(
    input: &[u8],
    width: u32,
    height: u32,
    inside: bool,
    no_enlargement: bool,
    max_pixels: u32,
    scaled: bool,
    mut sink: impl FnMut(&[u8], u32, u32) -> Result<(), JsValue>,
) -> Result<Stats, JsValue> {
    let (mut ctx, mut sw, mut sh) = (std::ptr::null_mut(), 0, 0);
    // Keep a separate source safety ceiling. maxPixels bounds output, and
    // allows bounded progressive-JPEG / Adam7 compatibility allocations.
    check(unsafe {
        rows_open(
            input.as_ptr(),
            input.len(),
            16_000_000,
            &mut ctx,
            &mut sw,
            &mut sh,
        )
    })?;
    let decoder = Decoder(ctx);
    let (ow, oh) = destination(sw, sh, width, height, inside, no_enlargement);
    if ow > 16383 || oh > 16383 || ow as u64 * oh as u64 > max_pixels as u64 {
        return Err(error("Output exceeds pixel or dimension limit"));
    }
    let (mut w, mut h) = (0, 0);
    check(unsafe { rows_start(decoder.0, ow, oh, scaled as i32, &mut w, &mut h) })?;
    let mut stats = Stats {
        source_width: sw,
        source_height: sh,
        decoded_width: w,
        decoded_height: h,
        output_width: ow,
        output_height: oh,
        peak_row_bytes: 0,
        codec_buffered: unsafe { rows_buffered(decoder.0) } != 0,
        opaque_input: unsafe { rows_opaque(decoder.0) } != 0,
    };
    let mut row = vec![0u8; w as usize * 4];
    // Preserve hidden RGB as well as alpha when no resizing is requested.
    if (w, h) == (ow, oh) {
        for _ in 0..h {
            check(unsafe { rows_read(decoder.0, row.as_mut_ptr()) })?;
            sink(&row, ow, oh)?;
        }
        check(unsafe { rows_finish(decoder.0) })?;
        stats.peak_row_bytes = row.len();
        return Ok(stats);
    }
    let xf = kernels(w as usize, ow as usize);
    let yf = kernels(h as usize, oh as usize);
    let mut output = vec![0u8; ow as usize * 4];
    let base = row.len() + output.len() + w as usize * 16 + ow as usize * 16;
    if oh <= h {
        let mut active: VecDeque<(usize, Vec<[f32; 4]>)> = VecDeque::new();
        let mut next = 0;
        for y in 0..h as usize {
            check(unsafe { rows_read(decoder.0, row.as_mut_ptr()) })?;
            let values = horizontal(&row, &xf, w == ow);
            while next < yf.len() && yf[next].start <= y {
                active.push_back((next, vec![[0.; 4]; ow as usize]));
                next += 1;
            }
            stats.peak_row_bytes = stats
                .peak_row_bytes
                .max(base + active.len() * ow as usize * 16);
            for (index, acc) in &mut active {
                let weight = yf[*index].weights[y - yf[*index].start];
                for (dst, src) in acc.iter_mut().zip(&values) {
                    add(dst, src, weight);
                }
            }
            while active
                .front()
                .is_some_and(|(i, _)| yf[*i].start + yf[*i].weights.len() == y + 1)
            {
                let (_, values) = active.pop_front().unwrap();
                emit(&values, &mut output);
                sink(&output, ow, oh)?;
            }
        }
    } else {
        let mut cache: VecDeque<Vec<[f32; 4]>> = VecDeque::new();
        let (mut first, mut read) = (0, 0);
        let mut acc = vec![[0.; 4]; ow as usize];
        for k in &yf {
            while first < k.start && !cache.is_empty() {
                cache.pop_front();
                first += 1;
            }
            while read < k.start + k.weights.len() {
                check(unsafe { rows_read(decoder.0, row.as_mut_ptr()) })?;
                cache.push_back(horizontal(&row, &xf, w == ow));
                read += 1;
            }
            stats.peak_row_bytes = stats
                .peak_row_bytes
                .max(base + (cache.len() + 1) * ow as usize * 16);
            acc.fill([0.; 4]);
            for (values, &weight) in cache.iter().zip(&k.weights) {
                for (dst, src) in acc.iter_mut().zip(values) {
                    add(dst, src, weight);
                }
            }
            emit(&acc, &mut output);
            sink(&output, ow, oh)?;
        }
    }
    check(unsafe { rows_finish(decoder.0) })?;
    Ok(stats)
}

unsafe extern "C" {
    fn rows_jpeg_open(w: u32, h: u32, quality: f32, out: *mut *mut c_void) -> i32;
    fn rows_jpeg_write(ctx: *mut c_void, row: *const u8) -> i32;
    fn rows_jpeg_finish(ctx: *mut c_void, bytes: *mut *mut u8, size: *mut usize) -> i32;
    fn rows_jpeg_close(ctx: *mut c_void);
}
pub struct JpegEncoder(*mut c_void);
impl Drop for JpegEncoder {
    fn drop(&mut self) {
        unsafe { rows_jpeg_close(self.0) }
    }
}
impl JpegEncoder {
    pub fn new() -> Self {
        Self(std::ptr::null_mut())
    }
    pub fn write(&mut self, row: &[u8], w: u32, h: u32, quality: f32) -> Result<(), JsValue> {
        if self.0.is_null() {
            if unsafe { rows_jpeg_open(w, h, quality, &mut self.0) } != 0 {
                return Err(error("JPEG encode failed"));
            }
        }
        if unsafe { rows_jpeg_write(self.0, row.as_ptr()) } != 0 {
            return Err(error("JPEG encode failed"));
        }
        Ok(())
    }
    pub fn finish(&mut self) -> Result<Vec<u8>, JsValue> {
        let (mut bytes, mut size) = (std::ptr::null_mut(), 0);
        if self.0.is_null() || unsafe { rows_jpeg_finish(self.0, &mut bytes, &mut size) } != 0 {
            return Err(error("JPEG encode failed"));
        }
        Ok(unsafe { std::slice::from_raw_parts(bytes, size) }.to_vec())
    }
}
