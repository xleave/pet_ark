#include "character.h"

#include <stddef.h>

static const PetHitbox amiya_default_relax_hitboxes[] = {
  { 56, 13, 91, 168 },
  { 52, 12, 95, 169 },
  { 43, 12, 104, 169 },
  { 35, 13, 112, 168 },
  { 38, 14, 110, 167 },
  { 47, 14, 102, 167 },
  { 59, 14, 90, 167 },
  { 60, 14, 88, 167 },
};
static const PetAnimationSource amiya_default_relax_source = {
  "relax", "amiya/default/relax.png", 8, 8, 1, amiya_default_relax_hitboxes
};

static const PetHitbox amiya_default_move_hitboxes[] = {
  { 64, 15, 87, 168 },
  { 70, 14, 79, 169 },
  { 63, 15, 87, 168 },
  { 57, 14, 93, 169 },
  { 63, 14, 86, 169 },
  { 70, 14, 79, 170 },
  { 61, 15, 89, 169 },
  { 54, 14, 98, 169 },
};
static const PetAnimationSource amiya_default_move_source = {
  "move", "amiya/default/move.png", 8, 8, 1, amiya_default_move_hitboxes
};

static const PetHitbox amiya_default_interact_hitboxes[] = {
  { 56, 13, 91, 168 },
  { 30, 19, 107, 162 },
  { 26, 19, 105, 162 },
  { 26, 19, 105, 162 },
  { 26, 19, 105, 162 },
  { 26, 19, 105, 162 },
  { 27, 21, 104, 160 },
  { 44, 19, 91, 162 },
};
static const PetAnimationSource amiya_default_interact_source = {
  "interact", "amiya/default/interact.png", 8, 8, 1, amiya_default_interact_hitboxes
};

static const PetHitbox amiya_default_sit_hitboxes[] = {
  { 64, 54, 90, 162 },
  { 69, 53, 90, 163 },
  { 64, 54, 90, 162 },
  { 69, 53, 90, 163 },
  { 64, 54, 90, 162 },
  { 69, 53, 90, 163 },
  { 64, 54, 90, 162 },
  { 69, 53, 90, 163 },
};
static const PetAnimationSource amiya_default_sit_source = {
  "sit", "amiya/default/sit.png", 8, 8, 1, amiya_default_sit_hitboxes
};

static const PetHitbox amiya_default_sleep_hitboxes[] = {
  { 8, 110, 176, 85 },
  { 8, 110, 176, 85 },
  { 8, 110, 176, 85 },
  { 9, 111, 175, 84 },
  { 10, 112, 174, 83 },
  { 10, 112, 174, 83 },
  { 10, 112, 174, 83 },
  { 9, 111, 175, 84 },
  { 9, 110, 175, 85 },
};
static const PetAnimationSource amiya_default_sleep_source = {
  "sleep", "amiya/default/sleep.png", 9, 8, 2, amiya_default_sleep_hitboxes
};

static const int amiya_default_idle_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_walk_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_walk_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_run_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_run_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_clicked_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_picked_up_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_dragging_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_dropped_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_rest_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_sleep_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8 };
static const int amiya_default_wake_order[] = { 0, 2, 3, 4, 5, 6, 7, 8 };
static const int amiya_default_special_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };

static const PetAnimationDefinition amiya_default_animations[] = {
  { "idle", &amiya_default_relax_source, amiya_default_idle_order, 8, 12, true, false, false, NULL },
  { "walk-left", &amiya_default_move_source, amiya_default_walk_left_order, 8, 12, true, true, false, NULL },
  { "walk-right", &amiya_default_move_source, amiya_default_walk_right_order, 8, 12, true, false, false, NULL },
  { "run-left", &amiya_default_move_source, amiya_default_run_left_order, 8, 18, true, true, false, NULL },
  { "run-right", &amiya_default_move_source, amiya_default_run_right_order, 8, 18, true, false, false, NULL },
  { "clicked", &amiya_default_interact_source, amiya_default_clicked_order, 8, 12, false, false, false, "idle" },
  { "picked-up", &amiya_default_sit_source, amiya_default_picked_up_order, 8, 12, false, false, false, "dragging" },
  { "dragging", &amiya_default_sit_source, amiya_default_dragging_order, 8, 6, true, false, false, NULL },
  { "dropped", &amiya_default_sit_source, amiya_default_dropped_order, 8, 12, false, false, false, "idle" },
  { "rest", &amiya_default_sit_source, amiya_default_rest_order, 8, 8, false, false, true, "sleep" },
  { "sleep", &amiya_default_sleep_source, amiya_default_sleep_order, 9, 10, true, false, false, NULL },
  { "wake", &amiya_default_sleep_source, amiya_default_wake_order, 8, 12, false, false, false, "idle" },
  { "special", &amiya_default_interact_source, amiya_default_special_order, 8, 12, false, false, false, "idle" },
};

static const PetVariant amiya_variants[] = {
  {
    .id = "default",
    .skin_id = NULL,
    .name = "默认",
    .localized_name = "默认",
    .variant_type = "base_form",
    .assets_subdir = "amiya/default",
    .default_scale = 1.0f,
    .can_mirror = true,
    .animations = amiya_default_animations,
    .animation_count = sizeof(amiya_default_animations) / sizeof(amiya_default_animations[0]),
    .state_fallbacks = NULL,
    .state_fallback_count = 0,
    .fallback_variant_id = NULL,
  },
};

const PetCharacter PET_CHARACTERS[] = {
  {
    "amiya", "Amiya", "阿米娅",
    68.0f, 116.0f, 4.0f, 11.0f, 75.0f,
    amiya_variants, sizeof(amiya_variants) / sizeof(amiya_variants[0]), "default"
  },
};
const size_t PET_CHARACTER_COUNT = sizeof(PET_CHARACTERS) / sizeof(PET_CHARACTERS[0]);
