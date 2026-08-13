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
  const char *requested;
  const char *fallback;
} PetStateFallback;

typedef struct {
  const char *id;
  const char *skin_id;
  const char *name;
  const char *localized_name;
  const char *variant_type;
  const char *assets_subdir;
  float default_scale;
  bool can_mirror;
  const PetAnimationDefinition *animations;
  size_t animation_count;
  const PetStateFallback *state_fallbacks;
  size_t state_fallback_count;
  const char *fallback_variant_id;
} PetVariant;

typedef struct {
  const char *id;
  const char *name;
  const char *localized_name;
  float walk_speed;
  float run_speed;
  float idle_min_seconds;
  float idle_max_seconds;
  float rest_after_seconds;
  const PetVariant *variants;
  size_t variant_count;
  const char *default_variant_id;
} PetCharacter;

typedef enum {
  PET_ANIMATION_UNRESOLVED,
  PET_ANIMATION_EXACT,
  PET_ANIMATION_STATE_FALLBACK,
  PET_ANIMATION_DEFAULT_VARIANT,
  PET_ANIMATION_DEFAULT_VARIANT_STATE_FALLBACK
} PetAnimationResolutionKind;

typedef struct {
  const PetAnimationDefinition *animation;
  const PetVariant *variant;
  const char *requested_state;
  const char *resolved_state;
  PetAnimationResolutionKind kind;
} PetAnimationResolution;

extern const PetCharacter PET_CHARACTERS[];
extern const size_t PET_CHARACTER_COUNT;

const PetCharacter *pet_character_find(const char *id);
const PetVariant *pet_character_default_variant(const PetCharacter *character);
const PetVariant *pet_character_variant(const PetCharacter *character, const char *id_or_skin);
const PetAnimationDefinition *pet_variant_animation_exact(const PetVariant *variant, const char *id);
bool pet_character_resolve_animation(const PetCharacter *character, const PetVariant *variant,
                                     const char *state, PetAnimationResolution *resolution);

#endif
