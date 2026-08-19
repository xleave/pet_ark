#include "../runtime/wayland.h"

#include <errno.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void usage(FILE *stream, const char *program) {
  fprintf(stream,
    "Usage: %s [options]\n"
    "\n"
    "Independent native-Wayland Arknights desktop pet.\n"
    "\n"
    "Options:\n"
    "  --character ID       Character registry id\n"
    "  --skin ID            Skin/variant id (default: character default)\n"
    "  --assets DIR         Runtime sprite atlas directory\n"
    "  --control-socket PATH\n"
    "                       Local JSON control socket\n"
    "  --instance ID        Runtime instance id (default: default)\n"
    "  --scale NUMBER       Display scale, 0.25..3.0 (default: character value)\n"
    "  --speed NUMBER       Movement speed multiplier, 0.1..5.0\n"
    "  --auto-move          Enable automatic movement\n"
    "  --no-auto-move       Stay in place unless dragged\n"
    "  --click-through      Start with an empty pointer input region\n"
    "  --no-click-through   Start with pointer interaction enabled\n"
    "  --xdg-fullscreen-fallback\n"
    "                       Explicitly allow xdg-shell fullscreen fallback\n"
    "  --monitor NUMBER     Zero-based Wayland output index\n"
    "  --probe              Print available shell capability and exit\n"
    "  --verbose            Print state and output diagnostics\n"
    "  --help               Show this help\n"
    "\n"
    "Runtime controls:\n"
    "  left click / drag    React to / move the pet\n"
    "  right click          Play the character's special animation\n"
    "  middle click         Toggle automatic movement\n"
    "  mouse wheel          Change scale\n"
    "  SIGUSR1              Toggle click-through\n"
    "  SIGUSR2              Toggle automatic movement\n"
    "  SIGHUP               Switch to the next registered character\n"
    "  SIGRTMIN             Switch to the next skin of this character\n",
    program);
}

static bool parse_float(const char *text, float minimum, float maximum, float *value) {
  char *end = NULL;
  errno = 0;
  const float parsed = strtof(text, &end);
  if (errno || !end || *end || parsed < minimum || parsed > maximum) return false;
  *value = parsed;
  return true;
}

static bool parse_monitor(const char *text, int *value) {
  char *end = NULL;
  errno = 0;
  const long parsed = strtol(text, &end, 10);
  if (errno || !end || *end || parsed < 0 || parsed > 255) return false;
  *value = (int)parsed;
  return true;
}

static bool parse_boolean(const char *text, bool *value) {
  if (!text) return false;
  if (!strcmp(text, "1") || !strcmp(text, "true") || !strcmp(text, "yes") || !strcmp(text, "on")) {
    *value = true;
    return true;
  }
  if (!strcmp(text, "0") || !strcmp(text, "false") || !strcmp(text, "no") || !strcmp(text, "off")) {
    *value = false;
    return true;
  }
  return false;
}

static bool parse_id(const char *text) {
  if (!text || !*text || strlen(text) >= 96) return false;
  for (const unsigned char *cursor = (const unsigned char *)text; *cursor; cursor++) {
    if (!((*cursor >= 'a' && *cursor <= 'z') || (*cursor >= 'A' && *cursor <= 'Z') ||
          (*cursor >= '0' && *cursor <= '9') || *cursor == '-' || *cursor == '_' || *cursor == '.')) return false;
  }
  return true;
}

static bool load_environment(PetWaylandConfig *config) {
  const char *value = NULL;
  config->character_id = getenv("PET_ARK_CHARACTER");
  config->skin_id = getenv("PET_ARK_VARIANT");
  config->assets_root = getenv("PET_ARK_ASSETS");
  config->control_socket = getenv("PET_ARK_CONTROL_SOCKET");
  config->instance_id = getenv("PET_ARK_INSTANCE");
  if (config->instance_id && !parse_id(config->instance_id)) {
    fprintf(stderr, "pet-ark: PET_ARK_INSTANCE contains unsupported characters\n");
    return false;
  }
  if ((value = getenv("PET_ARK_SCALE")) && !parse_float(value, 0.25f, 3.0f, &config->scale)) {
    fprintf(stderr, "pet-ark: PET_ARK_SCALE must be between 0.25 and 3.0\n");
    return false;
  }
  if ((value = getenv("PET_ARK_SPEED")) && !parse_float(value, 0.1f, 5.0f, &config->speed)) {
    fprintf(stderr, "pet-ark: PET_ARK_SPEED must be between 0.1 and 5.0\n");
    return false;
  }
  if ((value = getenv("PET_ARK_MONITOR")) && !parse_monitor(value, &config->monitor)) {
    fprintf(stderr, "pet-ark: PET_ARK_MONITOR must be a non-negative integer\n");
    return false;
  }
  struct {
    const char *name;
    bool *target;
  } booleans[] = {
    { "PET_ARK_AUTO_MOVE", &config->auto_move },
    { "PET_ARK_CLICK_THROUGH", &config->click_through },
    { "PET_ARK_XDG_FULLSCREEN_FALLBACK", &config->xdg_fullscreen_fallback },
    { "PET_ARK_VERBOSE", &config->verbose },
  };
  for (size_t index = 0; index < sizeof(booleans) / sizeof(booleans[0]); index++) {
    value = getenv(booleans[index].name);
    if (value && !parse_boolean(value, booleans[index].target)) {
      fprintf(stderr, "pet-ark: %s must be true/false or 1/0\n", booleans[index].name);
      return false;
    }
  }
  return true;
}

static const char *option_value(int argc, char **argv, int *index) {
  if (*index + 1 >= argc) return NULL;
  *index += 1;
  return argv[*index];
}

int main(int argc, char **argv) {
  PetWaylandConfig config = {
    .character_id = NULL,
    .skin_id = NULL,
    .assets_root = NULL,
    .control_socket = NULL,
    .instance_id = "default",
    .scale = 0.0f,
    .speed = 1.0f,
    .auto_move = true,
    .click_through = false,
    .xdg_fullscreen_fallback = false,
    .monitor = 0,
    .verbose = false,
  };
  bool probe = false;
  if (!load_environment(&config)) return 2;

  for (int index = 1; index < argc; index++) {
    const char *argument = argv[index];
    if (!strcmp(argument, "--help") || !strcmp(argument, "-h")) {
      usage(stdout, argv[0]);
      return 0;
    }
    if (!strcmp(argument, "--probe")) {
      probe = true;
      continue;
    }
    if (!strcmp(argument, "--no-auto-move")) {
      config.auto_move = false;
      continue;
    }
    if (!strcmp(argument, "--auto-move")) {
      config.auto_move = true;
      continue;
    }
    if (!strcmp(argument, "--click-through")) {
      config.click_through = true;
      continue;
    }
    if (!strcmp(argument, "--no-click-through")) {
      config.click_through = false;
      continue;
    }
    if (!strcmp(argument, "--xdg-fullscreen-fallback")) {
      config.xdg_fullscreen_fallback = true;
      continue;
    }
    if (!strcmp(argument, "--verbose")) {
      config.verbose = true;
      continue;
    }
    if (!strcmp(argument, "--character") || !strcmp(argument, "--skin") ||
        !strcmp(argument, "--assets") || !strcmp(argument, "--control-socket") ||
        !strcmp(argument, "--instance") ||
        !strcmp(argument, "--scale") || !strcmp(argument, "--speed") ||
        !strcmp(argument, "--monitor")) {
      const char *value = option_value(argc, argv, &index);
      if (!value) {
        fprintf(stderr, "pet-ark: %s needs a value\n", argument);
        return 2;
      }
      if (!strcmp(argument, "--character")) config.character_id = value;
      else if (!strcmp(argument, "--skin")) config.skin_id = value;
      else if (!strcmp(argument, "--assets")) config.assets_root = value;
      else if (!strcmp(argument, "--control-socket")) config.control_socket = value;
      else if (!strcmp(argument, "--instance")) {
        if (!parse_id(value)) {
          fprintf(stderr, "pet-ark: instance id contains unsupported characters\n");
          return 2;
        }
        config.instance_id = value;
      }
      else if (!strcmp(argument, "--scale")) {
        if (!parse_float(value, 0.25f, 3.0f, &config.scale)) {
          fprintf(stderr, "pet-ark: scale must be between 0.25 and 3.0\n");
          return 2;
        }
      } else if (!strcmp(argument, "--speed")) {
        if (!parse_float(value, 0.1f, 5.0f, &config.speed)) {
          fprintf(stderr, "pet-ark: speed must be between 0.1 and 5.0\n");
          return 2;
        }
      } else if (!parse_monitor(value, &config.monitor)) {
        fprintf(stderr, "pet-ark: monitor must be a non-negative integer\n");
        return 2;
      }
      continue;
    }
    fprintf(stderr, "pet-ark: unknown option: %s\n", argument);
    usage(stderr, argv[0]);
    return 2;
  }

  return probe ? pet_wayland_probe() : pet_wayland_run(&config);
}
