#include "character.h"

#include <string.h>

const PetCharacter *pet_character_find(const char *id) {
  for (size_t index = 0; index < PET_CHARACTER_COUNT; index++) {
    if (strcmp(PET_CHARACTERS[index].id, id) == 0) return &PET_CHARACTERS[index];
  }
  return NULL;
}

const PetAnimationDefinition *pet_character_animation(const PetCharacter *character, const char *id) {
  if (!character || !id) return NULL;
  for (size_t index = 0; index < character->animation_count; index++) {
    if (strcmp(character->animations[index].id, id) == 0) return &character->animations[index];
  }
  return NULL;
}
