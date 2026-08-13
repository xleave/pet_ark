#include "runtime_policy.h"

PetShellMode pet_shell_mode(bool has_layer_shell, bool has_xdg_shell,
                            bool allow_xdg_fullscreen) {
  if (has_layer_shell) return PET_SHELL_LAYER;
  if (has_xdg_shell && allow_xdg_fullscreen) return PET_SHELL_XDG_FULLSCREEN;
  return PET_SHELL_UNAVAILABLE;
}

void pet_runtime_set_auto_move(PetStateMachine *machine, bool *configured_value,
                               bool enabled) {
  pet_state_machine_set_auto_move(machine, enabled);
  if (configured_value) *configured_value = machine->auto_move;
}

void pet_runtime_toggle_auto_move(PetStateMachine *machine, bool *configured_value) {
  pet_runtime_set_auto_move(machine, configured_value, !machine->auto_move);
}

bool pet_visual_snapshot_changed(const PetVisualSnapshot *before,
                                 const PetVisualSnapshot *after) {
  return before->animation_definition != after->animation_definition ||
         before->source_frame != after->source_frame ||
         before->draw_x != after->draw_x || before->draw_y != after->draw_y;
}
