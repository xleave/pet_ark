#include "character.h"

#include <string.h>

const PetCharacter *pet_character_find(const char *id) {
  if (!id) return NULL;
  for (size_t index = 0; index < PET_CHARACTER_COUNT; index++) {
    if (strcmp(PET_CHARACTERS[index].id, id) == 0) return &PET_CHARACTERS[index];
  }
  return NULL;
}

const PetVariant *pet_character_variant(const PetCharacter *character, const char *id_or_skin) {
  if (!character || !id_or_skin) return NULL;
  for (size_t index = 0; index < character->variant_count; index++) {
    const PetVariant *variant = &character->variants[index];
    if (!strcmp(variant->id, id_or_skin) ||
        (variant->skin_id && !strcmp(variant->skin_id, id_or_skin))) return variant;
  }
  return NULL;
}

const PetVariant *pet_character_default_variant(const PetCharacter *character) {
  if (!character || character->variant_count == 0) return NULL;
  const PetVariant *variant = pet_character_variant(character, character->default_variant_id);
  return variant ? variant : &character->variants[0];
}

const PetAnimationDefinition *pet_variant_animation_exact(const PetVariant *variant, const char *id) {
  if (!variant || !id) return NULL;
  for (size_t index = 0; index < variant->animation_count; index++) {
    if (!strcmp(variant->animations[index].id, id)) return &variant->animations[index];
  }
  return NULL;
}

static const char *state_fallback(const PetVariant *variant, const char *state) {
  for (size_t index = 0; variant && index < variant->state_fallback_count; index++) {
    if (!strcmp(variant->state_fallbacks[index].requested, state))
      return variant->state_fallbacks[index].fallback;
  }
  return NULL;
}

static const PetAnimationDefinition *resolve_in_variant(const PetVariant *variant,
                                                        const char *requested,
                                                        const char **resolved_state,
                                                        bool *used_state_fallback) {
  const char *state = requested;
  const size_t limit = variant->state_fallback_count + 1;
  for (size_t depth = 0; state && depth < limit; depth++) {
    const PetAnimationDefinition *animation = pet_variant_animation_exact(variant, state);
    if (animation) {
      *resolved_state = state;
      *used_state_fallback = depth > 0;
      return animation;
    }
    state = state_fallback(variant, state);
  }
  return NULL;
}

bool pet_character_resolve_animation(const PetCharacter *character, const PetVariant *variant,
                                     const char *state, PetAnimationResolution *resolution) {
  if (resolution) *resolution = (PetAnimationResolution) { 0 };
  if (!character || !variant || !state || !resolution) return false;
  resolution->requested_state = state;

  bool state_fallback_used = false;
  const char *resolved_state = NULL;
  const PetAnimationDefinition *animation = resolve_in_variant(
    variant, state, &resolved_state, &state_fallback_used);
  if (animation) {
    resolution->animation = animation;
    resolution->variant = variant;
    resolution->resolved_state = resolved_state;
    resolution->kind = state_fallback_used ? PET_ANIMATION_STATE_FALLBACK : PET_ANIMATION_EXACT;
    return true;
  }

  const PetVariant *default_variant = pet_character_default_variant(character);
  if (!default_variant || default_variant == variant || !variant->fallback_variant_id ||
      strcmp(variant->fallback_variant_id, default_variant->id) != 0) return false;

  state_fallback_used = false;
  resolved_state = NULL;
  animation = resolve_in_variant(default_variant, state, &resolved_state, &state_fallback_used);
  if (!animation) return false;
  resolution->animation = animation;
  resolution->variant = default_variant;
  resolution->resolved_state = resolved_state;
  resolution->kind = state_fallback_used
    ? PET_ANIMATION_DEFAULT_VARIANT_STATE_FALLBACK
    : PET_ANIMATION_DEFAULT_VARIANT;
  return true;
}
