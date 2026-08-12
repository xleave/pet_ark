#include "animation.h"

void pet_animation_set(PetAnimationPlayer *player, const PetAnimationDefinition *definition) {
  if (player->definition == definition) return;
  player->definition = definition;
  player->elapsed = 0.0f;
  player->sequence_frame = 0;
  player->finished = false;
}

bool pet_animation_tick(PetAnimationPlayer *player, float delta) {
  if (!player->definition || player->definition->frame_count <= 0) return false;
  player->elapsed += delta;
  int frame = (int)(player->elapsed * player->definition->fps);
  if (frame >= player->definition->frame_count) {
    if (player->definition->loop) {
      frame %= player->definition->frame_count;
      player->elapsed = (float)frame / player->definition->fps;
    } else {
      frame = player->definition->frame_count - 1;
      player->finished = true;
    }
  }
  player->sequence_frame = frame;
  return player->finished;
}

int pet_animation_source_frame(const PetAnimationPlayer *player) {
  if (!player->definition || player->definition->frame_count <= 0) return 0;
  return player->definition->frame_order[player->sequence_frame];
}

const PetHitbox *pet_animation_hitbox(const PetAnimationPlayer *player) {
  if (!player->definition) return NULL;
  const int frame = pet_animation_source_frame(player);
  if (frame < 0 || frame >= player->definition->source->frame_count) return NULL;
  return &player->definition->source->hitboxes[frame];
}
