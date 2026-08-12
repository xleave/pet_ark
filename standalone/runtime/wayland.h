#ifndef PET_ARK_WAYLAND_H
#define PET_ARK_WAYLAND_H

#include <stdbool.h>

typedef struct {
  const char *character_id;
  const char *assets_root;
  float scale;
  float speed;
  bool auto_move;
  bool click_through;
  int monitor;
  bool verbose;
} PetWaylandConfig;

/* Runs until the compositor closes the surface or the process is signalled. */
int pet_wayland_run(const PetWaylandConfig *config);

/* Short capability probe used by packaging/CI without opening a surface. */
int pet_wayland_probe(void);

#endif
