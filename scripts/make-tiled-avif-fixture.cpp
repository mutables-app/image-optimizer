// Generate the synthetic 48 MP AV1 grid fixture used by Worker memory tests.
// Build with a host libheif configured with its AOM AV1 encoder enabled.
#include <libheif/heif.h>
#include <libheif/heif_tiling.h>

#include <cstdio>
#include <cstdlib>

static void check(heif_error error, const char* operation) {
    if (error.code != heif_error_Ok) {
        std::fprintf(stderr, "%s: %s (%d/%d)\n", operation, error.message,
                     error.code, error.subcode);
        std::exit(1);
    }
}

int main(int argc, char** argv) {
    constexpr uint32_t width = 8000;
    constexpr uint32_t height = 6000;
    constexpr uint32_t tile_width = 1024;
    constexpr uint32_t tile_height = 1024;
    constexpr uint32_t columns = 8;
    constexpr uint32_t rows = 6;
    const char* output = argc > 1 ? argv[1] : "test/fixtures/input-48mp-grid.avif";

    heif_context* context = heif_context_alloc();
    if (!context) return 2;

    heif_encoder* encoder = nullptr;
    check(heif_context_get_encoder_for_format(context, heif_compression_AV1, &encoder),
          "get AV1 encoder");
    check(heif_encoder_set_lossy_quality(encoder, 45), "set AV1 quality");
    check(heif_encoder_set_parameter_integer(encoder, "speed", 9), "set AV1 speed");

    heif_image_handle* grid = nullptr;
    check(heif_context_add_grid_image(context, width, height, columns, rows, nullptr, &grid),
          "create AV1 grid");

    for (uint32_t tile_y = 0; tile_y < rows; ++tile_y) {
        for (uint32_t tile_x = 0; tile_x < columns; ++tile_x) {
            heif_image* tile = nullptr;
            check(heif_image_create(tile_width, tile_height, heif_colorspace_RGB,
                                    heif_chroma_interleaved_RGB, &tile), "create tile");
            check(heif_image_add_plane(tile, heif_channel_interleaved, tile_width,
                                       tile_height, 8), "add tile plane");

            int stride = 0;
            uint8_t* pixels = heif_image_get_plane(tile, heif_channel_interleaved, &stride);
            if (!pixels || stride < static_cast<int>(tile_width * 3)) {
                std::fprintf(stderr, "invalid tile pixel plane\n");
                return 3;
            }

            for (uint32_t y = 0; y < tile_height; ++y) {
                for (uint32_t x = 0; x < tile_width; ++x) {
                    const uint32_t gx = tile_x * tile_width + x;
                    const uint32_t gy = tile_y * tile_height + y;
                    uint8_t* pixel = pixels + static_cast<size_t>(y) * stride + x * 3;
                    pixel[0] = static_cast<uint8_t>((gx * 3 + gy / 7) % 256);
                    pixel[1] = static_cast<uint8_t>((gy * 5 + gx / 11) % 256);
                    pixel[2] = static_cast<uint8_t>(((gx / 16) ^ (gy / 16)) * 13);
                }
            }

            heif_error error = heif_context_add_image_tile(context, grid, tile_x, tile_y,
                                                            tile, encoder);
            heif_image_release(tile);
            check(error, "encode AV1 tile");
            std::fprintf(stderr, "encoded tile %u/%u\n", tile_y * columns + tile_x + 1,
                         columns * rows);
        }
    }

    check(heif_context_write_to_file(context, output), "write AVIF grid");
    std::printf("%s\n", output);
    heif_image_handle_release(grid);
    heif_encoder_release(encoder);
    heif_context_free(context);
    return 0;
}
