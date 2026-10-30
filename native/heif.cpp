#include <libheif/heif.h>
#include <libheif/heif_tiling.h>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <new>

#define MAX_HEIF_SINGLE_IMAGE_PIXELS 12000000u
#define MAX_HEIF_GRID_PIXELS 48000000u
#define MAX_AVIF_GRID_PIXELS 64000000u

struct HeifRows {
    heif_context* context = nullptr;
    heif_image_handle* handle = nullptr;
    heif_image* image = nullptr;
    heif_image_tiling tiling{};
    const uint8_t* data = nullptr;
    size_t size = 0;
    const uint8_t* plane = nullptr;
    size_t stride = 0;
    uint32_t width = 0, height = 0, y = 0;
    uint8_t* tile_row = nullptr;
    uint32_t tile_row_first_y = 0, tile_row_height = 0, tile_row_index = 0;
    bool tiled = false;
    bool avif = false;
};

static bool is_heif_brand(const uint8_t* data, size_t size) {
    if (size < 12 || std::memcmp(data + 4, "ftyp", 4)) return false;
    static const char* brands[] = {"heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "avif", "avis"};
    for (const char* brand : brands) if (!std::memcmp(data + 8, brand, 4)) return true;
    for (size_t i = 16; i + 4 <= size && i < 128; i += 4)
        for (const char* brand : brands) if (!std::memcmp(data + i, brand, 4)) return true;
    return false;
}

extern "C" int heif_rows_open(const uint8_t* data, size_t size, void** out,
                               uint32_t* width, uint32_t* height) {
    *out = nullptr;
    if (!is_heif_brand(data, size)) return 5;
    auto* r = new (std::nothrow) HeifRows();
    if (!r) return 3;
    r->data = data; r->size = size;
    r->context = heif_context_alloc();
    if (!r->context) { delete r; return 3; }
    heif_context_set_max_decoding_threads(r->context, 1);
    heif_error err = heif_context_read_from_memory_without_copy(r->context, data, size, nullptr);
    if (err.code != heif_error_Ok ||
        heif_context_get_primary_image_handle(r->context, &r->handle).code != heif_error_Ok) {
        heif_context_free(r->context); delete r; return 1;
    }
    int w = heif_image_handle_get_width(r->handle);
    int h = heif_image_handle_get_height(r->handle);
    if (w <= 0 || h <= 0) {
        heif_image_handle_release(r->handle); heif_context_free(r->context); delete r; return 1;
    }
    r->width = static_cast<uint32_t>(w); r->height = static_cast<uint32_t>(h);
    for (size_t i = 8; i + 4 <= size && i < 128; i += 4) {
        if (!std::memcmp(data + i, "avif", 4) || !std::memcmp(data + i, "avis", 4)) {
            r->avif = true;
            break;
        }
    }
    if (heif_image_handle_get_image_tiling(r->handle, 1, &r->tiling).code == heif_error_Ok) {
        r->tiled = r->tiling.num_columns > 1 || r->tiling.num_rows > 1;
        if (r->tiled && (r->tiling.image_width != r->width || r->tiling.image_height != r->height ||
                         !r->tiling.num_columns || !r->tiling.num_rows ||
                         !r->tiling.tile_width || !r->tiling.tile_height)) {
            heif_image_handle_release(r->handle); heif_context_free(r->context); delete r; return 1;
        }
    }
    const uint64_t pixel_limit = r->tiled
        ? (r->avif ? MAX_AVIF_GRID_PIXELS : MAX_HEIF_GRID_PIXELS)
        : MAX_HEIF_SINGLE_IMAGE_PIXELS;
    if (static_cast<uint64_t>(r->width) * r->height > pixel_limit) {
        heif_image_handle_release(r->handle); heif_context_free(r->context); delete r; return 2;
    }
    *width = r->width; *height = r->height; *out = r;
    return 0;
}

extern "C" int heif_rows_start(void* opaque, uint32_t* width, uint32_t* height) {
    auto* r = static_cast<HeifRows*>(opaque);
    if (r->tiled) {
        uint32_t rows = r->tiling.tile_height;
        if (rows > r->height) rows = r->height;
        size_t bytes = static_cast<size_t>(r->width) * rows * 4;
        r->tile_row = static_cast<uint8_t*>(std::malloc(bytes));
        if (!r->tile_row) return 3;
        *width = r->width; *height = r->height;
        return 0;
    }
    heif_error err = heif_decode_image(r->handle, &r->image, heif_colorspace_RGB,
                                       heif_chroma_interleaved_RGBA, nullptr);
    if (err.code != heif_error_Ok) return 1;
    int w = heif_image_get_width(r->image, heif_channel_interleaved);
    int h = heif_image_get_height(r->image, heif_channel_interleaved);
    r->plane = heif_image_get_plane_readonly2(r->image, heif_channel_interleaved, &r->stride);
    if (!r->plane || w <= 0 || h <= 0 || r->stride < static_cast<size_t>(w) * 4) return 1;
    r->width = static_cast<uint32_t>(w); r->height = static_cast<uint32_t>(h);
    *width = r->width; *height = r->height;
    return 0;
}

static int heif_load_tile_row(HeifRows* r, uint32_t tile_y) {
    // libheif reports the transform's trailing remainder as offset; convert it
    // to the leading crop when placing tiles in the transformed output image.
    const uint32_t top_shift = r->tiling.top_offset
        ? r->tiling.tile_height - r->tiling.top_offset : 0;
    const uint32_t left_shift = r->tiling.left_offset
        ? r->tiling.tile_width - r->tiling.left_offset : 0;
    const int64_t row_origin = static_cast<int64_t>(tile_y) * r->tiling.tile_height - top_shift;
    const int64_t row_end = row_origin + r->tiling.tile_height;
    const int64_t first = row_origin < 0 ? 0 : row_origin;
    const int64_t last = row_end > r->height ? r->height : row_end;
    if (last <= first) return 1;
    r->tile_row_first_y = static_cast<uint32_t>(first);
    r->tile_row_height = static_cast<uint32_t>(last - first);
    std::memset(r->tile_row, 0, static_cast<size_t>(r->width) * r->tile_row_height * 4);

    for (uint32_t tile_x = 0; tile_x < r->tiling.num_columns; ++tile_x) {
        heif_image* tile = nullptr;
        heif_error err = heif_image_handle_decode_image_tile(
            r->handle, &tile, heif_colorspace_RGB, heif_chroma_interleaved_RGBA,
            nullptr, tile_x, tile_y);
        if (err.code != heif_error_Ok || !tile) {
            if (tile) heif_image_release(tile);
            return 1;
        }
        size_t stride = 0;
        const uint8_t* plane = heif_image_get_plane_readonly2(tile, heif_channel_interleaved, &stride);
        int tile_width = heif_image_get_width(tile, heif_channel_interleaved);
        int tile_height = heif_image_get_height(tile, heif_channel_interleaved);
        if (!plane || tile_width <= 0 || tile_height <= 0 || stride < static_cast<size_t>(tile_width) * 4) {
            heif_image_release(tile);
            return 1;
        }
        const int64_t col_origin = static_cast<int64_t>(tile_x) * r->tiling.tile_width - left_shift;
        const int64_t x0 = col_origin < 0 ? 0 : col_origin;
        const int64_t x1 = col_origin + tile_width > r->width ? r->width : col_origin + tile_width;
        const int64_t y0 = row_origin < 0 ? 0 : row_origin;
        const int64_t y1 = row_origin + tile_height > r->height ? r->height : row_origin + tile_height;
        if (x1 <= x0 || y1 <= y0) {
            heif_image_release(tile);
            return 1;
        }
        const uint32_t copy_width = static_cast<uint32_t>(x1 - x0);
        for (int64_t image_y = y0; image_y < y1; ++image_y) {
            const uint8_t* src = plane + static_cast<size_t>(image_y - row_origin) * stride +
                                 static_cast<size_t>(x0 - col_origin) * 4;
            uint8_t* dst = r->tile_row +
                (static_cast<size_t>(image_y - first) * r->width + static_cast<size_t>(x0)) * 4;
            std::memcpy(dst, src, static_cast<size_t>(copy_width) * 4);
        }
        heif_image_release(tile);
    }
    r->tile_row_index = tile_y;
    return 0;
}

extern "C" int heif_rows_read(void* opaque, uint8_t* out) {
    auto* r = static_cast<HeifRows*>(opaque);
    if (r->tiled) {
        const uint32_t top_shift = r->tiling.top_offset
            ? r->tiling.tile_height - r->tiling.top_offset : 0;
        uint32_t tile_y = (r->y + top_shift) / r->tiling.tile_height;
        if (tile_y >= r->tiling.num_rows) tile_y = r->tiling.num_rows - 1;
        if (!r->tile_row_height || r->y < r->tile_row_first_y ||
            r->y >= r->tile_row_first_y + r->tile_row_height) {
            if (heif_load_tile_row(r, tile_y)) return 1;
        }
        std::memcpy(out, r->tile_row + static_cast<size_t>(r->y - r->tile_row_first_y) * r->width * 4,
                    static_cast<size_t>(r->width) * 4);
        ++r->y;
        return 0;
    }
    if (!r->plane || r->y >= r->height) return 1;
    std::memcpy(out, r->plane + static_cast<size_t>(r->y++) * r->stride,
                static_cast<size_t>(r->width) * 4);
    return 0;
}

extern "C" int heif_rows_finish(void* opaque) {
    auto* r = static_cast<HeifRows*>(opaque);
    return r->y == r->height ? 0 : 1;
}

extern "C" int heif_rows_opaque(void* opaque) {
    auto* r = static_cast<HeifRows*>(opaque);
    return r && r->handle && !heif_image_handle_has_alpha_channel(r->handle);
}

extern "C" void heif_rows_close(void* opaque) {
    auto* r = static_cast<HeifRows*>(opaque);
    if (!r) return;
    if (r->image) heif_image_release(r->image);
    std::free(r->tile_row);
    if (r->handle) heif_image_handle_release(r->handle);
    if (r->context) heif_context_free(r->context);
    delete r;
}

extern "C" int heif_rows_buffered(void* opaque) {
    auto* r = static_cast<HeifRows*>(opaque);
    return !r || !r->tiled;
}
