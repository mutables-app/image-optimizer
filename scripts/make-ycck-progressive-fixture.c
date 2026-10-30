#include <stdio.h>
#include <stdlib.h>
#include <jpeglib.h>

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s input-cmyk.jpg output-ycck.jpg\n", argv[0]);
    return 2;
  }

  FILE *input = fopen(argv[1], "rb");
  FILE *output = fopen(argv[2], "wb");
  if (!input || !output) {
    perror("open JPEG");
    return 1;
  }

  struct jpeg_decompress_struct decoder;
  struct jpeg_compress_struct encoder;
  struct jpeg_error_mgr decoder_error, encoder_error;
  decoder.err = jpeg_std_error(&decoder_error);
  encoder.err = jpeg_std_error(&encoder_error);

  jpeg_create_decompress(&decoder);
  jpeg_stdio_src(&decoder, input);
  jpeg_read_header(&decoder, TRUE);
  if (decoder.jpeg_color_space != JCS_CMYK) {
    fprintf(stderr, "input JPEG must use CMYK color\n");
    return 1;
  }
  decoder.out_color_space = JCS_CMYK;

  jpeg_create_compress(&encoder);
  jpeg_stdio_dest(&encoder, output);
  encoder.image_width = decoder.image_width;
  encoder.image_height = decoder.image_height;
  encoder.input_components = 4;
  encoder.in_color_space = JCS_CMYK;
  jpeg_set_defaults(&encoder);
  jpeg_set_colorspace(&encoder, JCS_YCCK);
  jpeg_set_quality(&encoder, 82, TRUE);
  jpeg_simple_progression(&encoder);

  jpeg_start_decompress(&decoder);
  jpeg_start_compress(&encoder, TRUE);
  JSAMPARRAY row = (*decoder.mem->alloc_sarray)(
      (j_common_ptr)&decoder, JPOOL_IMAGE, decoder.output_width * 4, 1);
  while (decoder.output_scanline < decoder.output_height) {
    jpeg_read_scanlines(&decoder, row, 1);
    jpeg_write_scanlines(&encoder, row, 1);
  }

  jpeg_finish_decompress(&decoder);
  jpeg_finish_compress(&encoder);
  jpeg_destroy_decompress(&decoder);
  jpeg_destroy_compress(&encoder);
  fclose(input);
  fclose(output);
  return 0;
}
