#include <avif/avif.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MAX_AVIF_PIXELS 12000000u

static uint32_t round_positive(double value) {
    return (uint32_t)(value + 0.5);
}

static void destination_dimensions(uint32_t source_width, uint32_t source_height,
                                  uint32_t requested_width, uint32_t requested_height,
                                  int inside, int without_enlargement,
                                  uint32_t *output_width, uint32_t *output_height) {
    uint32_t width = requested_width;
    uint32_t height = requested_height;
    if (width == 0 && height == 0) {
        width = source_width;
        height = source_height;
    } else if (width == 0) {
        width = round_positive((double)source_width * height / source_height);
        if (width == 0) width = 1;
    } else if (height == 0) {
        height = round_positive((double)source_height * width / source_width);
        if (height == 0) height = 1;
    } else if (inside) {
        const double scale = ((double)width / source_width < (double)height / source_height)
                                 ? (double)width / source_width
                                 : (double)height / source_height;
        width = round_positive(source_width * scale);
        height = round_positive(source_height * scale);
        if (width == 0) width = 1;
        if (height == 0) height = 1;
    }
    if (without_enlargement) {
        double scale = (double)source_width / width;
        const double height_scale = (double)source_height / height;
        if (height_scale < scale) scale = height_scale;
        if (scale > 1.0) scale = 1.0;
        width = round_positive(width * scale);
        height = round_positive(height * scale);
        if (width == 0) width = 1;
        if (height == 0) height = 1;
    }
    *output_width = width;
    *output_height = height;
}

// Decode a single still AVIF to an owned RGBA8 buffer. libgav1 reconstructs
// complete AV1 frames, so this path intentionally uses a bounded full-frame
// decode rather than the scanline decoder used by JPEG and PNG.
int decode_avif(const uint8_t *data, size_t size,
                uint32_t requested_width, uint32_t requested_height,
                int inside, int without_enlargement, uint8_t **pixels,
                uint32_t *source_width, uint32_t *source_height,
                uint32_t *decoded_width, uint32_t *decoded_height) {
    *pixels = NULL;
    *source_width = 0;
    *source_height = 0;
    *decoded_width = 0;
    *decoded_height = 0;
    if (!data || !size) return 1;

    avifDecoder *decoder = avifDecoderCreate();
    if (!decoder) return 3;
    decoder->maxThreads = 1;
    decoder->ignoreExif = AVIF_TRUE;
    decoder->ignoreXMP = AVIF_TRUE;
    decoder->imageSizeLimit = MAX_AVIF_PIXELS;
    decoder->imageDimensionLimit = 16383;
    // Read enough sequence metadata to reject animation, while keeping the
    // parser's frame-count allocation bounded.
    decoder->imageCountLimit = 2;

    avifResult result = avifDecoderSetIOMemory(decoder, data, size);
    if (result != AVIF_RESULT_OK) {
        avifDecoderDestroy(decoder);
        return 1;
    }
    result = avifDecoderParse(decoder);
    if (result != AVIF_RESULT_OK) {
        const int too_large = strstr(decoder->diag.error, "too large") != NULL ||
                              strstr(decoder->diag.error, "imageSizeLimit") != NULL;
        avifDecoderDestroy(decoder);
        return too_large ? 2 : 1;
    }
    if (decoder->imageCount != 1) {
        avifDecoderDestroy(decoder);
        return 4;
    }

    if (!decoder->image->width || !decoder->image->height ||
        (uint64_t)decoder->image->width * decoder->image->height > MAX_AVIF_PIXELS) {
        avifDecoderDestroy(decoder);
        return 2;
    }

    result = avifDecoderNextImage(decoder);
    if (result != AVIF_RESULT_OK || !decoder->image || !decoder->image->width ||
        !decoder->image->height ||
        (uint64_t)decoder->image->width * decoder->image->height > MAX_AVIF_PIXELS) {
        avifDecoderDestroy(decoder);
        return result == AVIF_RESULT_OK ? 2 : 1;
    }

    // Read dimensions after NextImage so HEIF orientation transforms have
    // already been applied before we choose the reduced YUV dimensions.
    const uint32_t source_w = decoder->image->width;
    const uint32_t source_h = decoder->image->height;
    if (!source_w || !source_h || (uint64_t)source_w * source_h > MAX_AVIF_PIXELS) {
        avifDecoderDestroy(decoder);
        return 2;
    }
    uint32_t output_w, output_h;
    destination_dimensions(source_w, source_h, requested_width, requested_height,
                           inside, without_enlargement, &output_w, &output_h);
    uint32_t reduced_w = source_w;
    uint32_t reduced_h = source_h;
    if (output_w <= UINT32_MAX / 2 && output_h <= UINT32_MAX / 2) {
        const uint32_t twice_width = output_w * 2;
        const uint32_t twice_height = output_h * 2;
        if (twice_width < reduced_w) reduced_w = twice_width;
        if (twice_height < reduced_h) reduced_h = twice_height;
    }
    // Avoid allocating another YUV frame when pre-scaling would save little.
    if ((uint64_t)source_w * source_h <= (uint64_t)reduced_w * reduced_h * 5 / 4) {
        reduced_w = source_w;
        reduced_h = source_h;
    }

    if (reduced_w != source_w || reduced_h != source_h) {
        result = avifImageScale(decoder->image, reduced_w, reduced_h, &decoder->diag);
        if (result != AVIF_RESULT_OK) {
            avifDecoderDestroy(decoder);
            return 6;
        }
    }

    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, decoder->image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.maxThreads = 1;
    rgb.rowBytes = rgb.width * 4u;
    const size_t byte_count = (size_t)rgb.rowBytes * rgb.height;
    uint8_t *output = (uint8_t *)malloc(byte_count);
    if (!output) {
        avifDecoderDestroy(decoder);
        return 3;
    }
    rgb.pixels = output;
    result = avifImageYUVToRGB(decoder->image, &rgb);
    if (result != AVIF_RESULT_OK) {
        free(output);
        avifDecoderDestroy(decoder);
        return 5;
    }

    *pixels = output;
    *source_width = source_w;
    *source_height = source_h;
    *decoded_width = rgb.width;
    *decoded_height = rgb.height;
    avifDecoderDestroy(decoder);
    return 0;
}
