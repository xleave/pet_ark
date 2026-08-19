#ifndef PET_ARK_STATE_MACHINE_H
#define PET_ARK_STATE_MACHINE_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
  PET_BEHAVIOR_IDLE,
  PET_BEHAVIOR_MOVEMENT,
  PET_BEHAVIOR_INTERACTION,
  PET_BEHAVIOR_GRABBED,
  PET_BEHAVIOR_DROPPED,
  PET_BEHAVIOR_RESTING,
  PET_BEHAVIOR_SLEEPING,
  PET_BEHAVIOR_TRANSITION
} PetBehavior;

typedef enum {
  PET_EVENT_CLICK,
  PET_EVENT_SPECIAL,
  PET_EVENT_GRAB,
  PET_EVENT_RELEASE,
  PET_EVENT_USER_ACTIVITY,
  PET_EVENT_MOVE,
  PET_EVENT_RUN,
  PET_EVENT_REST,
  PET_EVENT_SLEEP,
  PET_EVENT_CANCEL
} PetEvent;

typedef struct {
  PetBehavior behavior;
  float elapsed;
  float since_user_activity;
  float deadline;
  float idle_min;
  float idle_max;
  float rest_after;
  bool auto_move;
  bool running;
  bool special_interaction;
  bool grab_transition;
  bool wake_on_click;
  uint32_t random_state;
} PetStateMachine;

void pet_state_machine_init(PetStateMachine *machine, uint32_t seed, float idle_min, float idle_max, float rest_after);
void pet_state_machine_dispatch(PetStateMachine *machine, PetEvent event);
void pet_state_machine_tick(PetStateMachine *machine, float delta, bool animation_finished, bool movement_finished);
void pet_state_machine_set_auto_move(PetStateMachine *machine, bool enabled);
const char *pet_state_machine_animation(const PetStateMachine *machine, int direction);

#endif
