// Row decoder. No longjmp crosses the C/Rust boundary: every libjpeg call
// that can fail installs its own recovery point in this translation unit.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <setjmp.h>
#include <jpeglib.h>
#include <spng.h>
#include <pngle.h>
#include <lowzag.h>

#define MAX_BUFFERED_SOURCE_PIXELS 48000000u
#define MAX_STREAMING_SOURCE_PIXELS 48000000u
#define MAX_LOWZAG_ALLOC_BYTES (64u * 1024u * 1024u)
#define MAX_LOWZAG_SOURCE_PIXELS 48000000u
#define MAX_CMYK_PROGRESSIVE_SOURCE_PIXELS 12000000u
#define MAX_ADAM7_SOURCE_PIXELS 12000000u
#define MAX_ADAM7_FALLBACK_SOURCE_PIXELS 12000000u
#define MAX_PROGRESSIVE_COEFFICIENT_BYTES (64u * 1024u * 1024u)
#define MAX_ADAM7_ACCUM_BYTES (48u * 1024u * 1024u)

// Adam7 callbacks arrive in pass order, so a conventional row resizer cannot
// consume them directly. Scatter each decoded sample through precomputed
// separable Lanczos weights into the small destination accumulator instead.
typedef struct { uint16_t destination; float weight; } AxisEntry;
typedef struct { uint8_t *counts; AxisEntry *entries; } AxisMap;
static AxisMap axis_map_create(uint32_t source, uint32_t target) {
    AxisMap map = { calloc(source, sizeof(uint8_t)),
                    malloc((size_t)source * 8 * sizeof(AxisEntry)) };
    if (!map.counts || !map.entries) {
        free(map.counts); free(map.entries);
        map.counts = NULL; map.entries = NULL;
        return map;
    }
    double scale = (double)source / target;
    double support = scale > 1.0 ? scale : 1.0;
    for (uint32_t i = 0; i < target; ++i) {
        double center = (i + 0.5) * scale;
        int start = (int)floor(center - 3.0 * support);
        if (start < 0) start = 0;
        int end = (int)ceil(center + 3.0 * support);
        if (end > (int)source) end = (int)source;
        double total = 0.0;
        for (int x = start; x < end; ++x) {
            double v = fabs((x + 0.5 - center) / support);
            if (v >= 3.0) continue;
            double p = v * 3.14159265358979323846;
            double w = v < 1e-12 ? 1.0 : sin(p) / p * sin(p / 3.0) / (p / 3.0);
            total += w;
        }
        for (int x = start; x < end; ++x) {
            double v = fabs((x + 0.5 - center) / support);
            if (v >= 3.0) continue;
            double p = v * 3.14159265358979323846;
            double w = v < 1e-12 ? 1.0 : sin(p) / p * sin(p / 3.0) / (p / 3.0);
            uint8_t n = map.counts[x];
            // Eight destinations cover the maximum support for the accepted
            // scale range; fail safely if a future geometry exceeds it.
            if (n >= 8) {
                free(map.counts); free(map.entries);
                map.counts = NULL; map.entries = NULL;
                return map;
            }
            map.entries[(size_t)x * 8 + n] = (AxisEntry){ (uint16_t)i, (float)(w / total) };
            map.counts[x]++;
        }
    }
    return map;
}

typedef struct {
    struct jpeg_error_mgr base;
    jmp_buf jump;
} RowError;
typedef struct {
    struct jpeg_decompress_struct jpeg;
    RowError error;
    int jpeg_created, png, buffered, cmyk, adobe_cmyk, lowzag_candidate, lowzag_ready;
    int pngle_ready, pngle_done, pngle_alloc_failed;
    const uint8_t *data;
    size_t size;
    spng_ctx *spng;
    pngle_t *pngle;
    void *heif;
    uint8_t *pixels, *cmyk_row;
    float *adam7_accum;
    AxisMap adam7_xmap, adam7_ymap;
    uint64_t adam7_samples;
    uint32_t adam7_target_w, adam7_target_h;
    uint32_t w, h, y;
} RowDecoder;
int heif_rows_open(const uint8_t *, size_t, void **, uint32_t *, uint32_t *);
int heif_rows_start(void *, uint32_t *, uint32_t *);
int heif_rows_read(void *, uint8_t *);
int heif_rows_finish(void *);
int heif_rows_opaque(void *);
int heif_rows_buffered(void *);
void heif_rows_close(void *);
static void row_error(j_common_ptr c) { longjmp(((RowError *)c->err)->jump, 1); }
static void row_message(j_common_ptr c, int level) { if (level < 0) row_error(c); }
static int jpeg_coefficients_fit(struct jpeg_decompress_struct *jpeg) {
    uint64_t blocks = 0;
    for (int i = 0; i < jpeg->num_components; ++i) {
        const jpeg_component_info *c = &jpeg->comp_info[i];
        uint64_t block_w = ((uint64_t)jpeg->image_width * c->h_samp_factor +
                            jpeg->max_h_samp_factor * DCTSIZE - 1) /
                           (jpeg->max_h_samp_factor * DCTSIZE);
        uint64_t block_h = ((uint64_t)jpeg->image_height * c->v_samp_factor +
                            jpeg->max_v_samp_factor * DCTSIZE - 1) /
                           (jpeg->max_v_samp_factor * DCTSIZE);
        if (block_w && block_h > (UINT64_MAX - blocks) / block_w) return 0;
        blocks += block_w * block_h;
    }
    return blocks <= MAX_PROGRESSIVE_COEFFICIENT_BYTES / sizeof(JBLOCK);
}
void rows_close(RowDecoder *r) {
    if (!r) return;
    if (r->jpeg_created) jpeg_destroy_decompress(&r->jpeg);
    if (r->spng) spng_ctx_free(r->spng);
    if (r->pngle) pngle_destroy(r->pngle);
    if (r->heif) heif_rows_close(r->heif);
    free(r->pixels); free(r->cmyk_row); free(r->adam7_accum);
    free(r->adam7_xmap.counts); free(r->adam7_xmap.entries);
    free(r->adam7_ymap.counts); free(r->adam7_ymap.entries); free(r);
}

static void adam7_init(pngle_t *pngle, uint32_t w, uint32_t h) {
    RowDecoder *r = pngle_get_user_data(pngle);
    if (w != r->w || h != r->h) { r->pngle_alloc_failed = 2; return; }
    size_t out_pixels = (size_t)r->adam7_target_w * r->adam7_target_h;
    r->pixels = malloc(out_pixels * 4);
    if (!r->pixels) { r->pngle_alloc_failed = 1; return; }
    if (w == r->adam7_target_w && h == r->adam7_target_h) return;
    r->adam7_accum = calloc(out_pixels * 4, sizeof(float));
    r->adam7_xmap = axis_map_create(w, r->adam7_target_w);
    r->adam7_ymap = axis_map_create(h, r->adam7_target_h);
    if (!r->adam7_accum || !r->adam7_xmap.counts || !r->adam7_ymap.counts)
        r->pngle_alloc_failed = 1;
}

static void adam7_draw(pngle_t *pngle, uint32_t x, uint32_t y,
                       uint32_t preview_w, uint32_t preview_h,
                       const uint8_t rgba[4]) {
    (void)preview_w; (void)preview_h;
    RowDecoder *r = pngle_get_user_data(pngle);
    if (r->pngle_alloc_failed || x >= r->w || y >= r->h) return;
    r->adam7_samples++;
    if (!r->adam7_accum) {
        memcpy(r->pixels + ((size_t)y * r->w + x) * 4, rgba, 4);
        return;
    }
    float alpha = rgba[3] / 255.0f;
    float value[4] = { rgba[0] * alpha, rgba[1] * alpha,
                       rgba[2] * alpha, rgba[3] };
    uint8_t ny = r->adam7_ymap.counts[y], nx = r->adam7_xmap.counts[x];
    for (uint8_t iy = 0; iy < ny; ++iy) {
        AxisEntry ey = r->adam7_ymap.entries[(size_t)y * 8 + iy];
        for (uint8_t ix = 0; ix < nx; ++ix) {
            AxisEntry ex = r->adam7_xmap.entries[(size_t)x * 8 + ix];
            float weight = ey.weight * ex.weight;
            float *dst = r->adam7_accum + ((size_t)ey.destination * r->adam7_target_w + ex.destination) * 4;
            for (int c = 0; c < 4; ++c) dst[c] += value[c] * weight;
        }
    }
}

static void adam7_done(pngle_t *pngle) {
    RowDecoder *r = pngle_get_user_data(pngle);
    r->pngle_done = 1;
}

static void adam7_release_working(RowDecoder *r) {
    free(r->adam7_accum); r->adam7_accum = NULL;
    free(r->adam7_xmap.counts); free(r->adam7_xmap.entries);
    free(r->adam7_ymap.counts); free(r->adam7_ymap.entries);
    r->adam7_xmap = (AxisMap){0}; r->adam7_ymap = (AxisMap){0};
}
// 1 = decode error, 2 = limit, 3 = allocation, 4 = format.
int rows_open(const uint8_t *data, size_t size, uint32_t max_source,
              RowDecoder **out, uint32_t *w, uint32_t *h) {
    *out = NULL;
    RowDecoder *r = calloc(1, sizeof(*r));
    if (!r) return 3;
    r->data = data; r->size = size;
    if (size >= 8 && !memcmp(data, "\x89PNG\r\n\x1a\n", 8)) {
        r->png = 1;
        r->spng = spng_ctx_new(0);
        if (!r->spng) { rows_close(r); return 3; }
        struct spng_ihdr header;
        if (spng_set_image_limits(r->spng, 16383, 16383) ||
            spng_set_chunk_limits(r->spng, 1024*1024, 4*1024*1024) ||
            spng_set_png_buffer(r->spng, data, size) || spng_get_ihdr(r->spng, &header)) {
            rows_close(r); return 1;
        }
        r->w = header.width; r->h = header.height;
        if ((uint64_t)r->w*r->h > MAX_STREAMING_SOURCE_PIXELS ||
            (uint64_t)r->w*r->h > max_source) { rows_close(r); return 2; }
        // Adam7 passes revisit rows. rows_start may route small downscales
        // through Pngle; otherwise the complete-image fallback is required.
        r->buffered = !!header.interlace_method;
        if (r->buffered && (uint64_t)r->w*r->h > MAX_ADAM7_SOURCE_PIXELS) {
            rows_close(r); return 2;
        }
    } else if (size >= 2 && data[0] == 0xff && data[1] == 0xd8) {
        r->jpeg.err = jpeg_std_error(&r->error.base);
        r->error.base.error_exit = row_error;
        r->error.base.emit_message = row_message;
        if (setjmp(r->error.jump)) { rows_close(r); return 1; }
        jpeg_create_decompress(&r->jpeg); r->jpeg_created = 1;
        jpeg_mem_src(&r->jpeg, data, size);
        jpeg_read_header(&r->jpeg, TRUE);
        r->w = r->jpeg.image_width; r->h = r->jpeg.image_height;
        if (!r->w || !r->h || r->w > 16383 || r->h > 16383) {
            rows_close(r); return 2;
        }
        r->buffered = r->jpeg.progressive_mode || jpeg_has_multiple_scans(&r->jpeg);
        r->cmyk = r->jpeg.jpeg_color_space == JCS_CMYK || r->jpeg.jpeg_color_space == JCS_YCCK;
        r->adobe_cmyk = r->jpeg.saw_Adobe_marker;
        // Keep both CMYK variants at 12 MP. CMYK can use the private Lowzag
        // four-plane path when reduced output is possible; YCCK remains on
        // libjpeg's full coefficient-buffer compatibility path.
        if (r->jpeg.progressive_mode && r->cmyk &&
            (uint64_t)r->w * r->h > MAX_CMYK_PROGRESSIVE_SOURCE_PIXELS) {
            rows_close(r); return 2;
        }
        if ((uint64_t)r->w * r->h > max_source) {
            rows_close(r); return 2;
        }
        if (r->jpeg.progressive_mode && !r->jpeg.arith_code &&
            r->jpeg.data_precision == 8 &&
            (((r->jpeg.num_components == 1 || r->jpeg.num_components == 3) && !r->cmyk &&
              (r->jpeg.jpeg_color_space == JCS_GRAYSCALE || r->jpeg.jpeg_color_space == JCS_YCbCr)) ||
             (r->jpeg.num_components == 4 && r->jpeg.jpeg_color_space == JCS_CMYK))) {
            int factors_ok = 1;
            for (int i = 0; i < r->jpeg.num_components; ++i) {
                if (r->jpeg.comp_info[i].h_samp_factor > 2 || r->jpeg.comp_info[i].v_samp_factor > 2)
                    factors_ok = 0;
            }
            r->lowzag_candidate = factors_ok &&
                lowzag_probe(data, size, NULL, NULL) == LOWZAG_OK;
        }
        if (r->lowzag_candidate &&
            (uint64_t)r->w*r->h > MAX_LOWZAG_SOURCE_PIXELS) {
            rows_close(r); return 2;
        }
        if ((uint64_t)r->w*r->h > MAX_STREAMING_SOURCE_PIXELS && !r->lowzag_candidate) {
            rows_close(r); return 2;
        }
        if (r->buffered && !r->lowzag_candidate && (uint64_t)r->w*r->h > MAX_BUFFERED_SOURCE_PIXELS) {
            rows_close(r); return 2;
        }
        if (r->buffered && !r->lowzag_candidate) {
            // CMYK progressive files commonly need more coefficient storage
            // per pixel than RGB. Their separate source cap bounds this
            // measured full-coefficient path; other JPEGs use the 64 MiB guard.
            if (!r->cmyk && !jpeg_coefficients_fit(&r->jpeg)) { rows_close(r); return 2; }
        }
    } else if (size >= 12 && !memcmp(data + 4, "ftyp", 4)) {
        int status = heif_rows_open(data, size, &r->heif, &r->w, &r->h);
        if (status) { rows_close(r); return status == 5 ? 4 : status; }
        if (!r->w || !r->h || r->w > 16383 || r->h > 16383 ||
            (uint64_t)r->w*r->h > max_source) { rows_close(r); return 2; }
        r->buffered = heif_rows_buffered(r->heif);
    } else { rows_close(r); return 4; }
    *w = r->w; *h = r->h; *out = r;
    return 0;
}
int rows_start(RowDecoder *r, uint32_t target_w, uint32_t target_h, int scaled,
               uint32_t *w, uint32_t *h) {
    if (r->png) {
        uint64_t accum_bytes = (uint64_t)target_w * target_h * 4 * sizeof(float);
        if (r->buffered && target_w <= r->w && target_h <= r->h &&
            accum_bytes <= MAX_ADAM7_ACCUM_BYTES) {
            r->adam7_target_w = target_w; r->adam7_target_h = target_h;
            r->pngle = pngle_new();
            if (!r->pngle) return 3;
            pngle_set_user_data(r->pngle, r);
            pngle_set_init_callback(r->pngle, adam7_init);
            pngle_set_draw_callback(r->pngle, adam7_draw);
            pngle_set_done_callback(r->pngle, adam7_done);
            int fed = pngle_feed(r->pngle, r->data, r->size);
            int valid = fed >= 0 && (size_t)fed == r->size && r->pngle_done &&
                        r->adam7_samples == (uint64_t)r->w * r->h && !r->pngle_alloc_failed;
            if (r->pngle_alloc_failed == 1) {
                pngle_destroy(r->pngle); r->pngle = NULL;
                free(r->pixels); r->pixels = NULL; adam7_release_working(r);
                return 3;
            }
            if (valid) {
                if (r->adam7_accum) {
                    size_t pixels = (size_t)target_w * target_h;
                    for (size_t i = 0; i < pixels; ++i) {
                        float alpha = fminf(255.0f, fmaxf(0.0f, r->adam7_accum[i * 4 + 3]));
                        r->pixels[i * 4 + 3] = (uint8_t)roundf(alpha);
                        for (int c = 0; c < 3; ++c) {
                            float value = alpha == 0.0f ? 0.0f : r->adam7_accum[i * 4 + c] * 255.0f / alpha;
                            r->pixels[i * 4 + c] = (uint8_t)roundf(fminf(255.0f, fmaxf(0.0f, value)));
                        }
                    }
                }
                pngle_destroy(r->pngle); r->pngle = NULL;
                adam7_release_working(r);
                if (r->spng) { spng_ctx_free(r->spng); r->spng = NULL; }
                r->pngle_ready = 1; r->buffered = 0;
                r->w = target_w; r->h = target_h;
                *w = r->w; *h = r->h;
                return 0;
            }
            pngle_destroy(r->pngle); r->pngle = NULL;
            free(r->pixels); r->pixels = NULL; adam7_release_working(r);
            r->adam7_samples = 0; r->pngle_done = 0; r->pngle_alloc_failed = 0;
        }
        if (r->buffered) {
            // Adam7's callback downscaler is bounded by the requested output.
            // The full-frame fallback is limited separately to keep it below
            // the Worker memory budget when the callback path cannot be used.
            if ((uint64_t)r->w*r->h > MAX_ADAM7_FALLBACK_SOURCE_PIXELS) return 2;
            // Called only after Rust validates the requested output geometry.
            size_t bytes = (size_t)r->w*r->h*4;
            r->pixels = malloc(bytes);
            if (!r->pixels) return 3;
            if (spng_decode_image(r->spng,r->pixels,bytes,SPNG_FMT_RGBA8,SPNG_DECODE_TRNS)) return 1;
        } else if (spng_decode_image(r->spng,NULL,0,SPNG_FMT_RGBA8,SPNG_DECODE_TRNS|SPNG_DECODE_PROGRESSIVE)) return 1;
    } else if (r->heif) {
        int status = heif_rows_start(r->heif, &r->w, &r->h);
        if (status) return status;
    } else {
        if (r->lowzag_candidate) {
            lowzag_cfg_t cfg = { .struct_size = sizeof cfg,
                                 .target_w = (int)target_w, .target_h = (int)target_h,
                                 .mem_limit = MAX_LOWZAG_ALLOC_BYTES };
            lowzag_estimate_t estimate = LOWZAG_ESTIMATE_INIT;
            lowzag_err_t status = lowzag_estimate(&cfg, r->data, r->size, &estimate);
            /* Keep the exact libjpeg path when no IDCT reduction is possible;
             * lowzag's memory advantage matters only for a reduced decode. */
            if (status == LOWZAG_OK && estimate.scale > 1 && estimate.out_w > 0 && estimate.out_h > 0 &&
                (uint64_t)estimate.out_w * estimate.out_h <= UINT64_MAX / (r->cmyk ? 4 : 3)) {
                size_t pixel_bytes = r->cmyk ? 4 : 3;
                size_t bytes = (size_t)estimate.out_w * estimate.out_h * pixel_bytes;
                r->pixels = malloc(bytes);
                if (!r->pixels) return 3;
                lowzag_info_t info = LOWZAG_INFO_INIT;
                status = lowzag_decode_mem(&cfg, r->data, r->size, r->pixels, bytes, &info);
                if (status == LOWZAG_OK && info.rows_delivered == estimate.out_h) {
                    r->lowzag_ready = 1;
                    r->w = (uint32_t)info.out_w; r->h = (uint32_t)info.out_h;
                    jpeg_destroy_decompress(&r->jpeg); r->jpeg_created = 0;
                    *w = r->w; *h = r->h;
                    return 0;
                }
                free(r->pixels); r->pixels = NULL;
            }
            /* Keep the existing full-resolution fallback for supported-size
             * inputs lowzag cannot handle. Larger coefficient-buffered JPEGs
             * must fail before libjpeg allocates its full coefficient array. */
            if ((uint64_t)r->jpeg.image_width * r->jpeg.image_height > MAX_BUFFERED_SOURCE_PIXELS)
                return 2;
            if (!r->cmyk && !jpeg_coefficients_fit(&r->jpeg)) return 2;
        }
        if (setjmp(r->error.jump)) return 1;
        if (scaled && target_w < r->w && target_h < r->h) {
            // libjpeg-turbo supports IDCT scaling in increments of 1/8.
            for (int numerator = 1; numerator <= 8; numerator++) {
                r->jpeg.scale_num = numerator; r->jpeg.scale_denom = 8;
                jpeg_calc_output_dimensions(&r->jpeg);
                if (r->jpeg.output_width >= target_w && r->jpeg.output_height >= target_h) break;
            }
        }
        r->jpeg.out_color_space = r->cmyk ? JCS_CMYK : JCS_EXT_RGBA;
        jpeg_start_decompress(&r->jpeg);
        r->w = r->jpeg.output_width; r->h = r->jpeg.output_height;
        if (r->cmyk) {
            r->cmyk_row = malloc((size_t)r->w*4);
            if (!r->cmyk_row) return 3;
        }
    }
    *w = r->w; *h = r->h; return 0;
}
int rows_read(RowDecoder *r, uint8_t *out) {
    if (r->y >= r->h) return 1;
    if (r->pngle_ready) {
        memcpy(out, r->pixels + (size_t)r->y*r->w*4, (size_t)r->w*4);
    } else if (r->png) {
        if (r->buffered) memcpy(out, r->pixels + (size_t)r->y*r->w*4, (size_t)r->w*4);
        else {
            int e = spng_decode_row(r->spng,out,(size_t)r->w*4);
            if (e && !(e == SPNG_EOI && r->y+1 == r->h)) return 1;
        }
    } else if (r->heif) {
        if (heif_rows_read(r->heif, out)) return 1;
    } else if (r->lowzag_ready) {
        const uint8_t *src = r->pixels + (size_t)r->y * r->w * (r->cmyk ? 4 : 3);
        for (uint32_t x = 0; x < r->w; ++x) {
            if (r->cmyk) {
                const uint8_t *p = src + x * 4;
                uint8_t *q = out + x * 4;
                for (int c = 0; c < 3; c++) q[c] = r->adobe_cmyk
                    ? (p[c] * p[3] + 127) / 255
                    : ((255 - p[c]) * (255 - p[3]) + 127) / 255;
                q[3] = 255;
            } else {
                out[x*4] = src[x*3]; out[x*4+1] = src[x*3+1];
                out[x*4+2] = src[x*3+2]; out[x*4+3] = 255;
            }
        }
    } else {
        if (setjmp(r->error.jump)) return 1;
        JSAMPROW row = r->cmyk ? r->cmyk_row : out;
        if (jpeg_read_scanlines(&r->jpeg, &row, 1) != 1) return 1;
        if (r->cmyk) for (uint32_t x=0; x<r->w; x++) {
            uint8_t *p = row+x*4, *q = out+x*4;
            for (int c=0;c<3;c++) q[c] = r->jpeg.saw_Adobe_marker
                ? (p[c]*p[3]+127)/255 : ((255-p[c])*(255-p[3])+127)/255;
            q[3] = 255;
        }
    }
    r->y++; return 0;
}
int rows_finish(RowDecoder *r) {
    if (r->y != r->h) return 1;
    if (r->heif) return heif_rows_finish(r->heif);
    if (r->pngle_ready) { free(r->pixels); r->pixels = NULL; return 0; }
    if (r->lowzag_ready) return 0;
    if (r->png) return spng_decode_chunks(r->spng) ? 1 : 0;
    if (setjmp(r->error.jump)) return 1;
    return jpeg_finish_decompress(&r->jpeg) ? 0 : 1;
}

// Baseline JPEG with standard Huffman tables encodes incrementally. Enabling
// optimized Huffman tables or progressive output would require frame storage.
typedef struct {
    struct jpeg_compress_struct jpeg;
    RowError error;
    int created;
    uint8_t *bytes, *row;
    unsigned long size;
} RowEncoder;
void rows_jpeg_close(RowEncoder *e) {
    if (!e) return;
    if (e->created) jpeg_destroy_compress(&e->jpeg);
    free(e->bytes); free(e->row); free(e);
}
int rows_jpeg_open(uint32_t w, uint32_t h, float quality, RowEncoder **out) {
    *out = NULL;
    RowEncoder *e = calloc(1,sizeof(*e));
    if (!e) return 3;
    e->jpeg.err = jpeg_std_error(&e->error.base);
    e->error.base.error_exit = row_error;
    e->error.base.emit_message = row_message;
    if (setjmp(e->error.jump)) { rows_jpeg_close(e); return 1; }
    jpeg_create_compress(&e->jpeg); e->created = 1;
    jpeg_mem_dest(&e->jpeg,&e->bytes,&e->size);
    e->jpeg.image_width=w; e->jpeg.image_height=h;
    e->jpeg.input_components=3; e->jpeg.in_color_space=JCS_RGB;
    jpeg_set_defaults(&e->jpeg);
    jpeg_set_quality(&e->jpeg,(int)(quality+0.5f),TRUE);
    e->jpeg.optimize_coding=FALSE;
    e->row=malloc((size_t)w*3);
    if (!e->row) {rows_jpeg_close(e);return 3;}
    jpeg_start_compress(&e->jpeg,TRUE);
    *out=e; return 0;
}
int rows_jpeg_write(RowEncoder *e, const uint8_t *rgba) {
    if (setjmp(e->error.jump)) return 1;
    for (uint32_t x=0;x<e->jpeg.image_width;x++) {
        const uint8_t *p=rgba+x*4;
        // JPEG has no alpha; composite onto white, consistently for both speeds.
        for (int c=0;c<3;c++) e->row[x*3+c]=(p[c]*p[3]+255*(255-p[3])+127)/255;
    }
    JSAMPROW row=e->row;
    return jpeg_write_scanlines(&e->jpeg,&row,1)==1 ? 0 : 1;
}
int rows_jpeg_finish(RowEncoder *e, uint8_t **bytes, size_t *size) {
    if (setjmp(e->error.jump)) return 1;
    jpeg_finish_compress(&e->jpeg);
    *bytes=e->bytes; *size=e->size; return 0;
}
// Flags describe codec-internal buffering, independently of the Rust row window.
int rows_buffered(RowDecoder *r) { return r->buffered; }
int rows_opaque(RowDecoder *r) { return r->heif ? heif_rows_opaque(r->heif) : !r->png; }
