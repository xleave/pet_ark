#ifndef PET_ARK_IMAGE_H
#define PET_ARK_IMAGE_H

#include <stdint.h>

typedef struct {
  int width;
  int height;
  uint32_t *pixels;
} PetImage;

int pet_image_load_png(PetImage *image, const char *path);
void pet_image_destroy(PetImage *image);

#endif
