#include "character.h"

#include <stddef.h>

static const PetHitbox amiya_default_relax_hitboxes[] = {
  { 74, 17, 123, 227 },
  { 69, 15, 128, 229 },
  { 57, 15, 140, 229 },
  { 46, 16, 151, 228 },
  { 49, 18, 149, 226 },
  { 63, 19, 136, 225 },
  { 78, 19, 122, 225 },
  { 79, 18, 120, 226 },
};
static const PetAnimationSource amiya_default_relax_source = {
  "relax", "amiya/default/relax.png", 8, 8, 1, amiya_default_relax_hitboxes
};

static const PetHitbox amiya_default_move_hitboxes[] = {
  { 85, 19, 117, 227 },
  { 94, 18, 106, 228 },
  { 87, 20, 114, 226 },
  { 80, 20, 122, 226 },
  { 74, 19, 127, 227 },
  { 84, 18, 115, 229 },
  { 93, 19, 107, 229 },
  { 86, 20, 114, 228 },
  { 77, 20, 125, 227 },
  { 72, 19, 132, 227 },
};
static const PetAnimationSource amiya_default_move_source = {
  "move", "amiya/default/move.png", 10, 8, 2, amiya_default_move_hitboxes
};

static const PetHitbox amiya_default_interact_hitboxes[] = {
  { 74, 17, 123, 227 },
  { 39, 35, 144, 209 },
  { 34, 34, 141, 210 },
  { 34, 34, 141, 210 },
  { 34, 34, 141, 210 },
  { 34, 34, 141, 210 },
  { 34, 33, 141, 211 },
  { 58, 26, 122, 218 },
};
static const PetAnimationSource amiya_default_interact_source = {
  "interact", "amiya/default/interact.png", 8, 8, 1, amiya_default_interact_hitboxes
};

static const PetHitbox amiya_default_sit_hitboxes[] = {
  { 85, 72, 122, 219 },
  { 88, 71, 118, 220 },
  { 92, 70, 121, 221 },
  { 89, 69, 122, 223 },
  { 85, 72, 122, 219 },
  { 88, 71, 118, 220 },
  { 92, 70, 121, 221 },
  { 89, 69, 122, 223 },
  { 85, 72, 122, 219 },
  { 88, 71, 118, 220 },
  { 92, 70, 121, 221 },
  { 89, 69, 122, 223 },
  { 85, 72, 122, 219 },
  { 88, 71, 118, 220 },
  { 92, 70, 121, 221 },
  { 89, 69, 122, 223 },
};
static const PetAnimationSource amiya_default_sit_source = {
  "sit", "amiya/default/sit.png", 16, 8, 2, amiya_default_sit_hitboxes
};

static const PetHitbox amiya_default_sleep_hitboxes[] = {
  { 9, 147, 238, 116 },
  { 9, 147, 238, 116 },
  { 9, 148, 238, 115 },
  { 9, 148, 238, 115 },
  { 10, 149, 237, 114 },
  { 10, 149, 237, 114 },
  { 11, 150, 236, 113 },
  { 11, 150, 236, 112 },
  { 12, 151, 235, 111 },
  { 12, 151, 235, 111 },
  { 12, 151, 235, 111 },
  { 12, 150, 235, 112 },
  { 12, 150, 235, 113 },
  { 11, 149, 236, 114 },
  { 11, 149, 236, 114 },
  { 10, 148, 237, 115 },
  { 10, 148, 237, 115 },
};
static const PetAnimationSource amiya_default_sleep_source = {
  "sleep", "amiya/default/sleep.png", 17, 8, 3, amiya_default_sleep_hitboxes
};

static const int amiya_default_idle_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_walk_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
static const int amiya_default_walk_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
static const int amiya_default_run_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
static const int amiya_default_run_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 };
static const int amiya_default_clicked_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };
static const int amiya_default_picked_up_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
static const int amiya_default_dragging_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
static const int amiya_default_dropped_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
static const int amiya_default_rest_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
static const int amiya_default_sleep_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
static const int amiya_default_wake_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
static const int amiya_default_special_order[] = { 0, 1, 2, 3, 4, 5, 6, 7 };

static const PetAnimationDefinition amiya_default_animations[] = {
  { "idle", &amiya_default_relax_source, amiya_default_idle_order, 8, 12, true, false, false, NULL },
  { "walk-left", &amiya_default_move_source, amiya_default_walk_left_order, 10, 12, true, true, false, NULL },
  { "walk-right", &amiya_default_move_source, amiya_default_walk_right_order, 10, 12, true, false, false, NULL },
  { "run-left", &amiya_default_move_source, amiya_default_run_left_order, 10, 18, true, true, false, NULL },
  { "run-right", &amiya_default_move_source, amiya_default_run_right_order, 10, 18, true, false, false, NULL },
  { "clicked", &amiya_default_interact_source, amiya_default_clicked_order, 8, 12, false, false, false, "idle" },
  { "picked-up", &amiya_default_sit_source, amiya_default_picked_up_order, 16, 12, false, false, false, "dragging" },
  { "dragging", &amiya_default_sit_source, amiya_default_dragging_order, 16, 6, true, false, false, NULL },
  { "dropped", &amiya_default_sit_source, amiya_default_dropped_order, 16, 12, false, false, false, "idle" },
  { "rest", &amiya_default_sit_source, amiya_default_rest_order, 16, 8, false, false, true, "sleep" },
  { "sleep", &amiya_default_sleep_source, amiya_default_sleep_order, 17, 10, true, false, false, NULL },
  { "wake", &amiya_default_sleep_source, amiya_default_wake_order, 17, 12, false, false, false, "idle" },
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
