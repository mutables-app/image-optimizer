// Row decoder. No longjmp crosses the C/Rust boundary: every libjpeg call
// that can fail installs its own recovery point in this translation unit.
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <jpeglib.h>
#include <spng.h>

typedef struct {
    struct jpeg_error_mgr base;
    jmp_buf jump;
} RowError;
typedef struct {
    struct jpeg_decompress_struct jpeg;
    RowError error;
    int jpeg_created, png, buffered, cmyk;
    spng_ctx *spng;
    uint8_t *pixels, *cmyk_row;
    uint32_t w, h, y;
} RowDecoder;
static void row_error(j_common_ptr c) { longjmp(((RowError *)c->err)->jump, 1); }
static void row_message(j_common_ptr c, int level) { if (level < 0) row_error(c); }
void rows_close(RowDecoder *r) {
    if (!r) return;
    if (r->jpeg_created) jpeg_destroy_decompress(&r->jpeg);
    if (r->spng) spng_ctx_free(r->spng);
    free(r->pixels); free(r->cmyk_row); free(r);
}
// 1 = decode error, 2 = limit, 3 = allocation, 4 = format.
int rows_open(const uint8_t *data, size_t size, uint32_t max_source,
              RowDecoder **out, uint32_t *w, uint32_t *h) {
    *out = NULL;
    RowDecoder *r = calloc(1, sizeof(*r));
    if (!r) return 3;
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
        if ((uint64_t)r->w*r->h > max_source) { rows_close(r); return 2; }
        // Adam7 passes revisit rows. Preserve compatibility using a bounded
        // complete decode, rather than claiming these are sequential rows.
        r->buffered = !!header.interlace_method;
    } else if (size >= 2 && data[0] == 0xff && data[1] == 0xd8) {
        r->jpeg.err = jpeg_std_error(&r->error.base);
        r->error.base.error_exit = row_error;
        r->error.base.emit_message = row_message;
        if (setjmp(r->error.jump)) { rows_close(r); return 1; }
        jpeg_create_decompress(&r->jpeg); r->jpeg_created = 1;
        jpeg_mem_src(&r->jpeg, data, size);
        jpeg_read_header(&r->jpeg, TRUE);
        r->w = r->jpeg.image_width; r->h = r->jpeg.image_height;
        if (!r->w || !r->h || r->w > 16383 || r->h > 16383 || (uint64_t)r->w*r->h > max_source) {
            rows_close(r); return 2;
        }
        r->cmyk = r->jpeg.jpeg_color_space == JCS_CMYK || r->jpeg.jpeg_color_space == JCS_YCCK;
    } else { rows_close(r); return 4; }
    *w = r->w; *h = r->h; *out = r;
    return 0;
}
int rows_start(RowDecoder *r, uint32_t target_w, uint32_t target_h, int scaled,
               uint32_t *w, uint32_t *h) {
    if (r->png) {
        if (r->buffered) {
            // Called only after Rust validates the requested output geometry.
            size_t bytes = (size_t)r->w*r->h*4;
            r->pixels = malloc(bytes);
            if (!r->pixels) return 3;
            if (spng_decode_image(r->spng,r->pixels,bytes,SPNG_FMT_RGBA8,SPNG_DECODE_TRNS)) return 1;
        } else if (spng_decode_image(r->spng,NULL,0,SPNG_FMT_RGBA8,SPNG_DECODE_TRNS|SPNG_DECODE_PROGRESSIVE)) return 1;
    } else {
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
    if (r->png) {
        if (r->buffered) memcpy(out, r->pixels + (size_t)r->y*r->w*4, (size_t)r->w*4);
        else {
            int e = spng_decode_row(r->spng,out,(size_t)r->w*4);
            if (e && !(e == SPNG_EOI && r->y+1 == r->h)) return 1;
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
int rows_buffered(RowDecoder *r) { return r->png ? r->buffered : r->jpeg.progressive_mode || jpeg_has_multiple_scans(&r->jpeg); }
