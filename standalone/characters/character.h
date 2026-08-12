#ifndef PET_ARK_CHARACTER_H
#define PET_ARK_CHARACTER_H

#include <stdbool.h>
#include <stddef.h>

typedef struct {
  int x;
  int y;
  int width;
  int height;
} PetHitbox;

typedef struct {
  const char *id;
  const char *sheet;
  int frame_count;
  int columns;
  int rows;
  const PetHitbox *hitboxes;
} PetAnimationSource;

typedef struct {
  const char *id;
  const PetAnimationSource *source;
  const int *frame_order;
  int frame_count;
  int fps;
  bool loop;
  bool mirror;
  bool hold_last;
  const char *next;
} PetAnimationDefinition;

typedef struct {
  const char *id;
  const char *name;
  const char *localized_name;
  float default_scale;
  float walk_speed;
  float run_speed;
  float idle_min_seconds;
  float idle_max_seconds;
  float rest_after_seconds;
  bool can_mirror;
  const PetAnimationDefinition *animations;
  size_t animation_count;
} PetCharacter;

extern const PetCharacter PET_CHARACTERS[];
extern const size_t PET_CHARACTER_COUNT;

const PetCharacter *pet_character_find(const char *id);
const PetAnimationDefinition *pet_character_animation(const PetCharacter *character, const char *id);

#endif
