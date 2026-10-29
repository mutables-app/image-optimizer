#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <turbojpeg.h>
#include <spng.h>
#include <webp/encode.h>

// Scaled JPEG decoding may accept a larger source than the normal decoded
// pixel limit, but only while producing a smaller bounded intermediate.
#define MAX_SCALED_JPEG_SOURCE_PIXELS 16000000u

// All allocated buffers cross the FFI with an explicit owner and release call.
int decode_image(const uint8_t *data, size_t size, uint32_t max_pixels,
                 uint32_t target_w, uint32_t target_h, int scaled,
                 uint8_t **pixels, uint32_t *width, uint32_t *height) {
    *pixels = NULL;
    if (size >= 8 && !memcmp(data, "\x89PNG\r\n\x1a\n", 8)) {
        spng_ctx *ctx = spng_ctx_new(0);
        if (!ctx) return 3;
        struct spng_ihdr header;
        size_t bytes = 0;
        int err = spng_set_image_limits(ctx, 16383, 16383);
        if (!err) err = spng_set_chunk_limits(ctx, 1024 * 1024, 4 * 1024 * 1024);
        if (!err) err = spng_set_png_buffer(ctx, data, size);
        if (!err) err = spng_get_ihdr(ctx, &header);
        if (!err && (uint64_t)header.width * header.height > max_pixels) {
            spng_ctx_free(ctx); return 2;
        }
        if (!err) err = spng_decoded_image_size(ctx, SPNG_FMT_RGBA8, &bytes);
        if (!err) {
            *pixels = malloc(bytes);
            if (!*pixels) err = 1;
        }
        if (!err) err = spng_decode_image(ctx, *pixels, bytes, SPNG_FMT_RGBA8, SPNG_DECODE_TRNS);
        if (!err) { *width = header.width; *height = header.height; }
        spng_ctx_free(ctx);
        if (err) { free(*pixels); *pixels = NULL; return 1; }
        return 0;
    }
    if (size >= 2 && data[0] == 0xff && data[1] == 0xd8) {
        tjhandle ctx = tj3Init(TJINIT_DECOMPRESS);
        if (!ctx) return 3;
        tj3Set(ctx, TJPARAM_STOPONWARNING, 1);
        if (tj3DecompressHeader(ctx, data, size)) { tj3Destroy(ctx); return 1; }
        int original_w = tj3Get(ctx, TJPARAM_JPEGWIDTH);
        int original_h = tj3Get(ctx, TJPARAM_JPEGHEIGHT);
        int lossless = tj3Get(ctx, TJPARAM_LOSSLESS);
        if (original_w <= 0 || original_h <= 0 || original_w > 16383 || original_h > 16383) {
            tj3Destroy(ctx); return 2;
        }
        int w = original_w, h = original_h;
        int can_scale = scaled && !lossless && target_w && target_h &&
                        target_w < (uint32_t)original_w && target_h < (uint32_t)original_h;
        if (can_scale) {
            int count = 0;
            tjscalingfactor *factors = tjGetScalingFactors(&count);
            tjscalingfactor best = TJUNSCALED;
            uint64_t best_area = (uint64_t)w * h;
            for (int i = 0; i < count; i++) {
                if (factors[i].num > factors[i].denom) continue;
                int sw = TJSCALED(original_w, factors[i]);
                int sh = TJSCALED(original_h, factors[i]);
                uint64_t area = (uint64_t)sw * sh;
                if ((uint32_t)sw >= target_w && (uint32_t)sh >= target_h && area < best_area) {
                    best = factors[i]; best_area = area;
                    w = sw; h = sh;
                }
            }
            if (tj3SetScalingFactor(ctx, best)) { tj3Destroy(ctx); return 1; }
        }
        uint64_t source_area = (uint64_t)original_w * original_h;
        uint64_t decoded_area = (uint64_t)w * h;
        if (source_area > max_pixels &&
            (!can_scale || source_area > MAX_SCALED_JPEG_SOURCE_PIXELS || decoded_area > max_pixels)) {
            tj3Destroy(ctx); return 2;
        }
        *pixels = malloc((size_t)w * h * 4);
        if (!*pixels) { tj3Destroy(ctx); return 3; }
        int err = tj3Decompress8(ctx, data, size, *pixels, w * 4, TJPF_RGBA);
        tj3Destroy(ctx);
        if (err) { free(*pixels); *pixels = NULL; return 1; }
        *width = w; *height = h; return 0;
    }
    return 4;
}
void release_pixels(uint8_t *pixels) { free(pixels); }
size_t encode_webp(const uint8_t *rgba, uint32_t w, uint32_t h, float quality,
                   int lossless, int method, uint8_t **output) {
    if (method >= 0) {
        WebPConfig config;
        WebPPicture picture;
        WebPMemoryWriter writer;
        *output = NULL;
        if (method > 6 || !WebPConfigPreset(&config, WEBP_PRESET_DEFAULT, lossless ? 70.0f : quality)) return 0;
        config.lossless = !!lossless;
        config.method = method;
        if (!WebPValidateConfig(&config) || !WebPPictureInit(&picture)) return 0;
        picture.use_argb = !!lossless;
        picture.width = w; picture.height = h;
        picture.writer = WebPMemoryWrite;
        picture.custom_ptr = &writer;
        WebPMemoryWriterInit(&writer);
        int ok = WebPPictureImportRGBA(&picture, rgba, w * 4) && WebPEncode(&config, &picture);
        WebPPictureFree(&picture);
        if (!ok) { WebPMemoryWriterClear(&writer); return 0; }
        *output = writer.mem;
        return writer.size;
    }
    return lossless ? WebPEncodeLosslessRGBA(rgba, w, h, w * 4, output)
                    : WebPEncodeRGBA(rgba, w, h, w * 4, quality, output);
}
void release_webp(uint8_t *output) { WebPFree(output); }

// Header-only preflight for experimental JPEG scaled decoding. The decoder
// still enforces original source limits before allocating any pixel buffer.
int jpeg_dimensions(const uint8_t *data, size_t size, uint32_t *w, uint32_t *h) {
    tjhandle ctx = tj3Init(TJINIT_DECOMPRESS);
    if (!ctx) return 3;
    int err = tj3DecompressHeader(ctx, data, size);
    int width = err ? 0 : tj3Get(ctx, TJPARAM_JPEGWIDTH);
    int height = err ? 0 : tj3Get(ctx, TJPARAM_JPEGHEIGHT);
    tj3Destroy(ctx);
    if (err || width <= 0 || height <= 0) return 1;
    *w = (uint32_t)width; *h = (uint32_t)height;
    return 0;
}
