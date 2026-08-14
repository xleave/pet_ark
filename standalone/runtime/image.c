#include "image.h"

#include <png.h>
#include <stdlib.h>
#include <string.h>

int pet_image_load_png(PetImage *image, const char *path) {
  png_image png = { .version = PNG_IMAGE_VERSION };
  memset(image, 0, sizeof(*image));
  if (!png_image_begin_read_from_file(&png, path)) return -1;
  png.format = PNG_FORMAT_BGRA;
  uint8_t *pixels = malloc(PNG_IMAGE_SIZE(png));
  if (!pixels) {
    png_image_free(&png);
    return -1;
  }
  if (!png_image_finish_read(&png, NULL, pixels, 0, NULL)) {
    free(pixels);
    png_image_free(&png);
    return -1;
  }
  for (size_t offset = 0; offset < PNG_IMAGE_SIZE(png); offset += 4) {
    const unsigned alpha = pixels[offset + 3];
    pixels[offset] = (uint8_t)((pixels[offset] * alpha + 127) / 255);
    pixels[offset + 1] = (uint8_t)((pixels[offset + 1] * alpha + 127) / 255);
    pixels[offset + 2] = (uint8_t)((pixels[offset + 2] * alpha + 127) / 255);
  }
  image->width = (int)png.width;
  image->height = (int)png.height;
  image->pixels = (uint32_t *)pixels;
  png_image_free(&png);
  return 0;
}

void pet_image_destroy(PetImage *image) {
  free(image->pixels);
  memset(image, 0, sizeof(*image));
}
