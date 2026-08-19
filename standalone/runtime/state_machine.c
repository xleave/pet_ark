#include "state_machine.h"

static uint32_t random_next(PetStateMachine *machine) {
  uint32_t value = machine->random_state ? machine->random_state : 0x6d2b79f5u;
  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;
  machine->random_state = value;
  return value;
}

static float random_unit(PetStateMachine *machine) {
  return (random_next(machine) & 0x00ffffffu) / 16777215.0f;
}

static void enter_idle(PetStateMachine *machine) {
  machine->behavior = PET_BEHAVIOR_IDLE;
  machine->elapsed = 0.0f;
  machine->deadline = machine->idle_min + (machine->idle_max - machine->idle_min) * random_unit(machine);
}

void pet_state_machine_init(PetStateMachine *machine, uint32_t seed, float idle_min, float idle_max, float rest_after) {
  *machine = (PetStateMachine) {
    .behavior = PET_BEHAVIOR_IDLE,
    .idle_min = idle_min,
    .idle_max = idle_max,
    .rest_after = rest_after,
    .auto_move = true,
    .random_state = seed
  };
  enter_idle(machine);
}

void pet_state_machine_dispatch(PetStateMachine *machine, PetEvent event) {
  machine->since_user_activity = 0.0f;
  machine->elapsed = 0.0f;
  switch (event) {
    case PET_EVENT_CLICK:
      machine->special_interaction = false;
      machine->behavior = machine->behavior == PET_BEHAVIOR_SLEEPING || machine->wake_on_click
        ? PET_BEHAVIOR_TRANSITION
        : PET_BEHAVIOR_INTERACTION;
      machine->wake_on_click = false;
      break;
    case PET_EVENT_SPECIAL:
      machine->special_interaction = true;
      machine->behavior = PET_BEHAVIOR_INTERACTION;
      break;
    case PET_EVENT_GRAB:
      machine->wake_on_click = machine->behavior == PET_BEHAVIOR_SLEEPING || machine->behavior == PET_BEHAVIOR_RESTING;
      machine->grab_transition = true;
      machine->behavior = PET_BEHAVIOR_GRABBED;
      break;
    case PET_EVENT_RELEASE:
      machine->wake_on_click = false;
      machine->grab_transition = false;
      machine->behavior = PET_BEHAVIOR_DROPPED;
      break;
    case PET_EVENT_USER_ACTIVITY:
      if (machine->behavior == PET_BEHAVIOR_SLEEPING || machine->behavior == PET_BEHAVIOR_RESTING) machine->behavior = PET_BEHAVIOR_TRANSITION;
      break;
    case PET_EVENT_MOVE:
    case PET_EVENT_RUN:
      machine->special_interaction = false;
      machine->running = event == PET_EVENT_RUN;
      machine->behavior = PET_BEHAVIOR_MOVEMENT;
      break;
    case PET_EVENT_REST:
      machine->special_interaction = false;
      machine->behavior = PET_BEHAVIOR_RESTING;
      break;
    case PET_EVENT_SLEEP:
      machine->special_interaction = false;
      machine->behavior = PET_BEHAVIOR_SLEEPING;
      break;
    case PET_EVENT_CANCEL:
      machine->special_interaction = false;
      machine->grab_transition = false;
      machine->wake_on_click = false;
      enter_idle(machine);
      break;
  }
}

void pet_state_machine_tick(PetStateMachine *machine, float delta, bool animation_finished, bool movement_finished) {
  machine->elapsed += delta;
  machine->since_user_activity += delta;
  switch (machine->behavior) {
    case PET_BEHAVIOR_IDLE:
      if (machine->since_user_activity >= machine->rest_after) {
        machine->behavior = PET_BEHAVIOR_RESTING;
        machine->elapsed = 0.0f;
      } else if (machine->auto_move && machine->elapsed >= machine->deadline) {
        machine->behavior = PET_BEHAVIOR_MOVEMENT;
        machine->running = random_unit(machine) > 0.78f;
        machine->elapsed = 0.0f;
      }
      break;
    case PET_BEHAVIOR_MOVEMENT:
      if (movement_finished) enter_idle(machine);
      break;
    case PET_BEHAVIOR_INTERACTION:
    case PET_BEHAVIOR_DROPPED:
    case PET_BEHAVIOR_TRANSITION:
      if (animation_finished) enter_idle(machine);
      break;
    case PET_BEHAVIOR_RESTING:
      if (animation_finished) {
        machine->behavior = PET_BEHAVIOR_SLEEPING;
        machine->elapsed = 0.0f;
      }
      break;
    case PET_BEHAVIOR_GRABBED:
      if (machine->grab_transition && animation_finished) {
        machine->grab_transition = false;
        machine->elapsed = 0.0f;
      }
      break;
    case PET_BEHAVIOR_SLEEPING:
      break;
  }
}

void pet_state_machine_set_auto_move(PetStateMachine *machine, bool enabled) {
  machine->auto_move = enabled;
  if (!enabled && machine->behavior == PET_BEHAVIOR_MOVEMENT) enter_idle(machine);
}

const char *pet_state_machine_animation(const PetStateMachine *machine, int direction) {
  switch (machine->behavior) {
    case PET_BEHAVIOR_IDLE: return "idle";
    case PET_BEHAVIOR_MOVEMENT:
      if (machine->running) return direction < 0 ? "run-left" : "run-right";
      return direction < 0 ? "walk-left" : "walk-right";
    case PET_BEHAVIOR_INTERACTION: return machine->special_interaction ? "special" : "clicked";
    case PET_BEHAVIOR_GRABBED: return machine->grab_transition ? "picked-up" : "dragging";
    case PET_BEHAVIOR_DROPPED: return "dropped";
    case PET_BEHAVIOR_RESTING: return "rest";
    case PET_BEHAVIOR_SLEEPING: return "sleep";
    case PET_BEHAVIOR_TRANSITION: return "wake";
  }
  return "idle";
}
