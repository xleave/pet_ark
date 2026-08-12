#include "movement.h"

#include <math.h>

static float random_unit(PetMovement *movement) {
  uint32_t value = movement->random_state ? movement->random_state : 0xa341316cu;
  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;
  movement->random_state = value;
  return (value & 0x00ffffffu) / 16777215.0f;
}

void pet_movement_init(PetMovement *movement, uint32_t seed) {
  *movement = (PetMovement) { .speed_multiplier = 1.0f, .direction = 1, .random_state = seed };
}

void pet_movement_set_bounds(PetMovement *movement, int surface_width, int surface_height, int sprite_width, int sprite_height) {
  movement->surface_width = surface_width;
  movement->surface_height = surface_height;
  movement->sprite_width = sprite_width;
  movement->sprite_height = sprite_height;
  const float max_x = fmaxf(0.0f, surface_width - sprite_width);
  movement->x = fminf(fmaxf(0.0f, movement->x), max_x);
  movement->y = fmaxf(0.0f, surface_height - sprite_height - 16.0f);
}

void pet_movement_choose_target(PetMovement *movement) {
  const float max_x = fmaxf(0.0f, movement->surface_width - movement->sprite_width);
  movement->target_x = max_x * random_unit(movement);
  movement->direction = movement->target_x < movement->x ? -1 : 1;
}

bool pet_movement_tick(PetMovement *movement, float delta, float pixels_per_second) {
  const float remaining = movement->target_x - movement->x;
  const float distance = pixels_per_second * movement->speed_multiplier * delta;
  if (fabsf(remaining) <= distance) {
    movement->x = movement->target_x;
    return true;
  }
  movement->direction = remaining < 0.0f ? -1 : 1;
  movement->x += distance * movement->direction;
  return false;
}

void pet_movement_drag(PetMovement *movement, float x, float y) {
  const float max_x = fmaxf(0.0f, movement->surface_width - movement->sprite_width);
  const float max_y = fmaxf(0.0f, movement->surface_height - movement->sprite_height);
  movement->x = fminf(fmaxf(0.0f, x), max_x);
  movement->y = fminf(fmaxf(0.0f, y), max_y);
}
