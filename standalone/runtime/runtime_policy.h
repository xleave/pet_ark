#ifndef PET_ARK_RUNTIME_POLICY_H
#define PET_ARK_RUNTIME_POLICY_H

#include "state_machine.h"

#include <stdbool.h>

typedef enum {
  PET_SHELL_UNAVAILABLE,
  PET_SHELL_LAYER,
  PET_SHELL_XDG_FULLSCREEN,
} PetShellMode;

typedef struct {
  const void *animation_definition;
  int source_frame;
  int draw_x;
  int draw_y;
} PetVisualSnapshot;

PetShellMode pet_shell_mode(bool has_layer_shell, bool has_xdg_shell,
                            bool allow_xdg_fullscreen);

void pet_runtime_set_auto_move(PetStateMachine *machine, bool *configured_value,
                               bool enabled);
void pet_runtime_toggle_auto_move(PetStateMachine *machine, bool *configured_value);

bool pet_visual_snapshot_changed(const PetVisualSnapshot *before,
                                 const PetVisualSnapshot *after);

#endif
