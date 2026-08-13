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
    "  --scale NUMBER       Display scale, 0.25..3.0 (default: character value)\n"
    "  --speed NUMBER       Movement speed multiplier, 0.1..5.0\n"
    "  --no-auto-move       Stay in place unless dragged\n"
    "  --click-through      Start with an empty pointer input region\n"
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
    .scale = 0.0f,
    .speed = 1.0f,
    .auto_move = true,
    .click_through = false,
    .monitor = 0,
    .verbose = false,
  };
  bool probe = false;

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
    if (!strcmp(argument, "--click-through")) {
      config.click_through = true;
      continue;
    }
    if (!strcmp(argument, "--verbose")) {
      config.verbose = true;
      continue;
    }
    if (!strcmp(argument, "--character") || !strcmp(argument, "--skin") ||
        !strcmp(argument, "--assets") ||
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
