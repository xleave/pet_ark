#ifndef PET_ARK_MOVEMENT_H
#define PET_ARK_MOVEMENT_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  float x;
  float y;
  float target_x;
  float speed_multiplier;
  int direction;
  int surface_width;
  int surface_height;
  int sprite_width;
  int sprite_height;
  uint32_t random_state;
} PetMovement;

void pet_movement_init(PetMovement *movement, uint32_t seed);
void pet_movement_set_bounds(PetMovement *movement, int surface_width, int surface_height, int sprite_width, int sprite_height);
void pet_movement_choose_target(PetMovement *movement);
bool pet_movement_tick(PetMovement *movement, float delta, float pixels_per_second);
void pet_movement_drag(PetMovement *movement, float x, float y);

#endif
