#include "animation.h"
#include "movement.h"
#include "runtime_policy.h"
#include "state_machine.h"

#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int assertions;

#define CHECK(condition) do { \
  assertions++; \
  if (!(condition)) { \
    fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #condition); \
    exit(EXIT_FAILURE); \
  } \
} while (0)

#define CHECK_NEAR(actual, expected, tolerance) \
  CHECK(fabsf((actual) - (expected)) <= (tolerance))

static void test_state_machine_movement_cycle(void) {
  PetStateMachine machine;
  pet_state_machine_init(&machine, 7u, 1.0f, 2.0f, 30.0f);

  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);
  CHECK(machine.auto_move);
  CHECK(machine.deadline >= 1.0f && machine.deadline <= 2.0f);
  machine.deadline = 0.1f;
  pet_state_machine_tick(&machine, 0.2f, false, false);
  CHECK(machine.behavior == PET_BEHAVIOR_MOVEMENT);
  CHECK(strcmp(pet_state_machine_animation(&machine, -1), machine.running ? "run-left" : "walk-left") == 0);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), machine.running ? "run-right" : "walk-right") == 0);

  pet_state_machine_tick(&machine, 0.1f, false, true);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);

  machine.behavior = PET_BEHAVIOR_MOVEMENT;
  pet_state_machine_set_auto_move(&machine, false);
  CHECK(!machine.auto_move);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);
  machine.deadline = 0.0f;
  pet_state_machine_tick(&machine, 5.0f, false, false);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);
}

static void test_state_machine_interactions(void) {
  PetStateMachine machine;
  pet_state_machine_init(&machine, 19u, 2.0f, 3.0f, 60.0f);

  pet_state_machine_dispatch(&machine, PET_EVENT_CLICK);
  CHECK(machine.behavior == PET_BEHAVIOR_INTERACTION);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "clicked") == 0);
  pet_state_machine_tick(&machine, 0.2f, true, false);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);

  pet_state_machine_dispatch(&machine, PET_EVENT_GRAB);
  CHECK(machine.behavior == PET_BEHAVIOR_GRABBED);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "picked-up") == 0);
  pet_state_machine_tick(&machine, 0.5f, true, false);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "dragging") == 0);
  pet_state_machine_tick(&machine, 100.0f, true, true);
  CHECK(machine.behavior == PET_BEHAVIOR_GRABBED);

  pet_state_machine_dispatch(&machine, PET_EVENT_RELEASE);
  CHECK(machine.behavior == PET_BEHAVIOR_DROPPED);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "dropped") == 0);
  pet_state_machine_tick(&machine, 0.2f, true, false);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);

  pet_state_machine_dispatch(&machine, PET_EVENT_SPECIAL);
  CHECK(machine.behavior == PET_BEHAVIOR_INTERACTION);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "special") == 0);
}

static void test_state_machine_rest_and_wake(void) {
  PetStateMachine machine;
  pet_state_machine_init(&machine, 31u, 100.0f, 100.0f, 1.0f);
  pet_state_machine_tick(&machine, 1.1f, false, false);
  CHECK(machine.behavior == PET_BEHAVIOR_RESTING);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "rest") == 0);
  pet_state_machine_tick(&machine, 0.5f, true, false);
  CHECK(machine.behavior == PET_BEHAVIOR_SLEEPING);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "sleep") == 0);

  pet_state_machine_dispatch(&machine, PET_EVENT_CLICK);
  CHECK(machine.behavior == PET_BEHAVIOR_TRANSITION);
  CHECK(strcmp(pet_state_machine_animation(&machine, 1), "wake") == 0);
  pet_state_machine_tick(&machine, 0.5f, true, false);
  CHECK(machine.behavior == PET_BEHAVIOR_IDLE);
  CHECK_NEAR(machine.since_user_activity, 0.5f, 0.0001f);

  machine.behavior = PET_BEHAVIOR_SLEEPING;
  pet_state_machine_dispatch(&machine, PET_EVENT_GRAB);
  CHECK(machine.behavior == PET_BEHAVIOR_GRABBED);
  pet_state_machine_dispatch(&machine, PET_EVENT_CLICK);
  CHECK(machine.behavior == PET_BEHAVIOR_TRANSITION);
}

static void test_movement_bounds_target_and_drag(void) {
  PetMovement movement;
  pet_movement_init(&movement, 47u);
  CHECK_NEAR(movement.speed_multiplier, 1.0f, 0.0001f);
  CHECK(movement.direction == 1);

  movement.x = 1500.0f;
  pet_movement_set_bounds(&movement, 1000, 700, 100, 200);
  CHECK_NEAR(movement.x, 900.0f, 0.0001f);
  CHECK_NEAR(movement.y, 484.0f, 0.0001f);
  pet_movement_choose_target(&movement);
  CHECK(movement.target_x >= 0.0f && movement.target_x <= 900.0f);
  CHECK(movement.direction == (movement.target_x < movement.x ? -1 : 1));

  movement.x = 0.0f;
  movement.target_x = 100.0f;
  movement.speed_multiplier = 1.0f;
  CHECK(!pet_movement_tick(&movement, 0.5f, 50.0f));
  CHECK_NEAR(movement.x, 25.0f, 0.0001f);
  CHECK(movement.direction == 1);
  CHECK(pet_movement_tick(&movement, 2.0f, 50.0f));
  CHECK_NEAR(movement.x, 100.0f, 0.0001f);

  movement.target_x = 0.0f;
  movement.speed_multiplier = 2.0f;
  CHECK(!pet_movement_tick(&movement, 0.25f, 50.0f));
  CHECK_NEAR(movement.x, 75.0f, 0.0001f);
  CHECK(movement.direction == -1);

  pet_movement_drag(&movement, -50.0f, 1000.0f);
  CHECK_NEAR(movement.x, 0.0f, 0.0001f);
  CHECK_NEAR(movement.y, 500.0f, 0.0001f);
  pet_movement_drag(&movement, 1000.0f, -20.0f);
  CHECK_NEAR(movement.x, 900.0f, 0.0001f);
  CHECK_NEAR(movement.y, 0.0f, 0.0001f);
}

static void test_animation_player(void) {
  static const PetHitbox hitboxes[] = {
    { 1, 2, 3, 4 },
    { 5, 6, 7, 8 },
    { 9, 10, 11, 12 },
  };
  static const PetAnimationSource source = {
    "test", "test.png", 3, 3, 1, hitboxes
  };
  static const int order[] = { 2, 0, 1 };
  static const PetAnimationDefinition once = {
    "once", &source, order, 3, 10, false, false, true, "idle"
  };
  static const PetAnimationDefinition loop = {
    "loop", &source, order, 3, 10, true, true, false, NULL
  };
  PetAnimationPlayer player = { 0 };

  CHECK(!pet_animation_tick(&player, 1.0f));
  CHECK(pet_animation_source_frame(&player) == 0);
  CHECK(pet_animation_hitbox(&player) == NULL);

  pet_animation_set(&player, &once);
  CHECK(player.definition == &once);
  CHECK(!player.finished);
  CHECK(!pet_animation_tick(&player, 0.05f));
  CHECK(player.sequence_frame == 0);
  CHECK(pet_animation_source_frame(&player) == 2);
  CHECK(pet_animation_hitbox(&player) == &hitboxes[2]);
  CHECK(!pet_animation_tick(&player, 0.06f));
  CHECK(player.sequence_frame == 1);
  CHECK(pet_animation_source_frame(&player) == 0);
  CHECK(pet_animation_tick(&player, 0.30f));
  CHECK(player.sequence_frame == 2);
  CHECK(player.finished);

  pet_animation_set(&player, &once);
  CHECK(player.finished);
  pet_animation_set(&player, &loop);
  CHECK(!player.finished);
  CHECK(!pet_animation_tick(&player, 0.35f));
  CHECK(player.sequence_frame == 0);
  CHECK(pet_animation_source_frame(&player) == 2);
}

static void test_auto_move_survives_selection_reinitialization(void) {
  PetStateMachine machine;
  bool configured_auto_move = true;
  pet_state_machine_init(&machine, 61u, 1.0f, 2.0f, 30.0f);

  pet_runtime_toggle_auto_move(&machine, &configured_auto_move);
  CHECK(!machine.auto_move);
  CHECK(!configured_auto_move);

  /* apply_selection() reinitializes the machine, then reapplies this setting. */
  pet_state_machine_init(&machine, 67u, 1.0f, 2.0f, 30.0f);
  CHECK(machine.auto_move);
  pet_runtime_set_auto_move(&machine, &configured_auto_move, configured_auto_move);
  CHECK(!machine.auto_move);
  CHECK(!configured_auto_move);

  pet_runtime_toggle_auto_move(&machine, &configured_auto_move);
  pet_state_machine_init(&machine, 71u, 1.0f, 2.0f, 30.0f);
  pet_runtime_set_auto_move(&machine, &configured_auto_move, configured_auto_move);
  CHECK(machine.auto_move);
  CHECK(configured_auto_move);
}

static void test_shell_fallback_policy(void) {
  CHECK(pet_shell_mode(true, true, false) == PET_SHELL_LAYER);
  CHECK(pet_shell_mode(true, false, false) == PET_SHELL_LAYER);
  CHECK(pet_shell_mode(false, true, false) == PET_SHELL_UNAVAILABLE);
  CHECK(pet_shell_mode(false, true, true) == PET_SHELL_XDG_FULLSCREEN);
  CHECK(pet_shell_mode(false, false, true) == PET_SHELL_UNAVAILABLE);
}

static void test_visual_snapshot_dirty_detection(void) {
  static const int first_definition = 1;
  static const int second_definition = 2;
  const PetVisualSnapshot baseline = { &first_definition, 3, 120, 240 };
  PetVisualSnapshot candidate = baseline;

  CHECK(!pet_visual_snapshot_changed(&baseline, &candidate));
  candidate.source_frame = 4;
  CHECK(pet_visual_snapshot_changed(&baseline, &candidate));
  candidate = baseline;
  candidate.animation_definition = &second_definition;
  CHECK(pet_visual_snapshot_changed(&baseline, &candidate));
  candidate = baseline;
  candidate.draw_x++;
  CHECK(pet_visual_snapshot_changed(&baseline, &candidate));
  candidate = baseline;
  candidate.draw_y--;
  CHECK(pet_visual_snapshot_changed(&baseline, &candidate));
}

int main(void) {
  test_state_machine_movement_cycle();
  test_state_machine_interactions();
  test_state_machine_rest_and_wake();
  test_movement_bounds_target_and_drag();
  test_animation_player();
  test_auto_move_survives_selection_reinitialization();
  test_shell_fallback_policy();
  test_visual_snapshot_dirty_detection();
  printf("OK: %d runtime assertions (state machine, movement, animation, runtime policy)\n", assertions);
  return EXIT_SUCCESS;
}
