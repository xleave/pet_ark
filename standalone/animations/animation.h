#ifndef PET_ARK_ANIMATION_H
#define PET_ARK_ANIMATION_H

#include <stdbool.h>

#include "../characters/character.h"

typedef struct {
  const PetAnimationDefinition *definition;
  float elapsed;
  int sequence_frame;
  bool finished;
} PetAnimationPlayer;

void pet_animation_set(PetAnimationPlayer *player, const PetAnimationDefinition *definition);
bool pet_animation_tick(PetAnimationPlayer *player, float delta);
int pet_animation_source_frame(const PetAnimationPlayer *player);
const PetHitbox *pet_animation_hitbox(const PetAnimationPlayer *player);

#endif
