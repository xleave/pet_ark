#include "character.h"

#include <stddef.h>

static const PetHitbox amiya_relax_hitboxes[] = {
  { 73, 58, 200, 370 },
  { 67, 57, 205, 371 },
  { 59, 56, 214, 372 },
  { 44, 56, 228, 372 },
  { 30, 57, 242, 371 },
  { 26, 58, 247, 370 },
  { 32, 60, 242, 368 },
  { 45, 62, 231, 366 },
  { 63, 62, 214, 366 },
  { 79, 62, 198, 366 },
  { 82, 61, 194, 367 },
  { 79, 60, 195, 368 },
};
static const PetAnimationSource amiya_relax_source = {
  "relax", "amiya/relax.png", 12, 8, 2, amiya_relax_hitboxes
};

static const PetHitbox amiya_move_hitboxes[] = {
  { 90, 61, 190, 371 },
  { 106, 62, 172, 369 },
  { 101, 62, 176, 369 },
  { 92, 63, 186, 368 },
  { 84, 63, 196, 368 },
  { 76, 62, 204, 369 },
  { 74, 62, 204, 369 },
  { 89, 61, 187, 372 },
  { 102, 61, 174, 374 },
  { 100, 62, 177, 372 },
  { 89, 63, 188, 371 },
  { 79, 63, 201, 370 },
  { 70, 62, 213, 370 },
  { 72, 61, 211, 371 },
};
static const PetAnimationSource amiya_move_source = {
  "move", "amiya/move.png", 14, 8, 2, amiya_move_hitboxes
};

static const PetHitbox amiya_interact_hitboxes[] = {
  { 73, 58, 200, 370 },
  { 31, 80, 221, 348 },
  { 11, 87, 236, 341 },
  { 8, 86, 228, 342 },
  { 8, 86, 228, 342 },
  { 7, 86, 229, 342 },
  { 7, 86, 229, 342 },
  { 7, 86, 229, 342 },
  { 7, 86, 229, 342 },
  { 7, 85, 230, 343 },
  { 28, 79, 213, 349 },
  { 54, 67, 201, 361 },
};
static const PetAnimationSource amiya_interact_source = {
  "interact", "amiya/interact.png", 12, 8, 2, amiya_interact_hitboxes
};

static const PetHitbox amiya_sit_hitboxes[] = {
  { 90, 149, 192, 299 },
  { 91, 146, 192, 302 },
  { 95, 147, 193, 301 },
  { 100, 149, 194, 299 },
  { 102, 145, 197, 303 },
  { 100, 143, 200, 305 },
  { 95, 145, 197, 303 },
  { 91, 150, 191, 298 },
  { 89, 147, 192, 301 },
  { 93, 146, 192, 302 },
  { 98, 149, 193, 299 },
  { 101, 147, 195, 301 },
  { 101, 143, 200, 305 },
  { 98, 143, 199, 305 },
  { 93, 147, 194, 301 },
  { 90, 149, 192, 299 },
  { 91, 146, 192, 302 },
  { 95, 147, 193, 301 },
  { 100, 149, 194, 299 },
  { 102, 145, 197, 303 },
  { 100, 143, 200, 305 },
  { 95, 145, 197, 303 },
  { 91, 150, 191, 298 },
  { 89, 147, 192, 301 },
  { 93, 146, 192, 302 },
  { 98, 149, 193, 299 },
  { 101, 147, 195, 301 },
  { 101, 143, 200, 305 },
  { 98, 143, 199, 305 },
  { 93, 147, 194, 301 },
};
static const PetAnimationSource amiya_sit_source = {
  "sit", "amiya/sit.png", 30, 8, 4, amiya_sit_hitboxes
};

static const PetHitbox amiya_sleep_hitboxes[] = {
  { 0, 271, 353, 177 },
  { 0, 271, 353, 177 },
  { 0, 272, 353, 176 },
  { 0, 272, 354, 176 },
  { 0, 272, 354, 176 },
  { 0, 273, 354, 175 },
  { 0, 273, 354, 175 },
  { 0, 274, 354, 174 },
  { 0, 274, 354, 174 },
  { 0, 275, 354, 173 },
  { 0, 275, 354, 173 },
  { 0, 275, 354, 173 },
  { 0, 276, 354, 172 },
  { 0, 276, 354, 172 },
  { 0, 276, 354, 172 },
  { 0, 277, 354, 171 },
  { 0, 277, 354, 171 },
  { 0, 276, 354, 172 },
  { 0, 276, 354, 172 },
  { 0, 276, 354, 172 },
  { 0, 275, 354, 173 },
  { 0, 275, 354, 173 },
  { 0, 274, 354, 174 },
  { 0, 274, 354, 174 },
  { 0, 273, 354, 175 },
  { 0, 273, 354, 175 },
  { 0, 272, 354, 176 },
  { 0, 272, 354, 176 },
  { 0, 272, 353, 176 },
  { 0, 271, 353, 177 },
};
static const PetAnimationSource amiya_sleep_source = {
  "sleep", "amiya/sleep.png", 30, 8, 4, amiya_sleep_hitboxes
};

static const int amiya_idle_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
static const int amiya_walk_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 };
static const int amiya_walk_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 };
static const int amiya_run_left_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 };
static const int amiya_run_right_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 };
static const int amiya_clicked_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };
static const int amiya_picked_up_order[] = { 0, 1, 2, 3, 4, 5 };
static const int amiya_dragging_order[] = { 5, 6, 7, 8, 9, 10 };
static const int amiya_dropped_order[] = { 5, 4, 3, 2, 1, 0 };
static const int amiya_rest_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29 };
static const int amiya_sleep_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29 };
static const int amiya_wake_order[] = { 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 };
static const int amiya_special_order[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 };

static const PetAnimationDefinition amiya_animations[] = {
  { "idle", &amiya_relax_source, amiya_idle_order, 12, 12, true, false, false, NULL },
  { "walk-left", &amiya_move_source, amiya_walk_left_order, 14, 12, true, true, false, NULL },
  { "walk-right", &amiya_move_source, amiya_walk_right_order, 14, 12, true, false, false, NULL },
  { "run-left", &amiya_move_source, amiya_run_left_order, 14, 18, true, true, false, NULL },
  { "run-right", &amiya_move_source, amiya_run_right_order, 14, 18, true, false, false, NULL },
  { "clicked", &amiya_interact_source, amiya_clicked_order, 12, 12, false, false, false, "idle" },
  { "picked-up", &amiya_sit_source, amiya_picked_up_order, 6, 12, false, false, false, "dragging" },
  { "dragging", &amiya_sit_source, amiya_dragging_order, 6, 6, true, false, false, NULL },
  { "dropped", &amiya_sit_source, amiya_dropped_order, 6, 12, false, false, false, "idle" },
  { "rest", &amiya_sit_source, amiya_rest_order, 30, 8, false, false, true, "sleep" },
  { "sleep", &amiya_sleep_source, amiya_sleep_order, 30, 10, true, false, false, NULL },
  { "wake", &amiya_sleep_source, amiya_wake_order, 30, 12, false, false, false, "idle" },
  { "special", &amiya_interact_source, amiya_special_order, 12, 12, false, false, false, "idle" },
};

const PetCharacter PET_CHARACTERS[] = {
  {
    "amiya", "Amiya", "阿米娅", 1.0f,
    68.0f, 116.0f, 4.0f, 11.0f, 75.0f,
    true, amiya_animations, sizeof(amiya_animations) / sizeof(amiya_animations[0])
  },
};
const size_t PET_CHARACTER_COUNT = sizeof(PET_CHARACTERS) / sizeof(PET_CHARACTERS[0]);
