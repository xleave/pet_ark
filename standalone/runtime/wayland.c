#define _GNU_SOURCE

#include "wayland.h"

#include "image.h"
#include "movement.h"
#include "runtime_policy.h"
#include "state_machine.h"
#include "../animations/animation.h"
#include "../characters/character.h"
#include "protocol/wlr-layer-shell-unstable-v1-client-protocol.h"
#include "protocol/xdg-decoration-unstable-v1-client-protocol.h"
#include "protocol/xdg-shell-client-protocol.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/input-event-codes.h>
#include <math.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>
#include <wayland-client.h>

#define PET_BUFFER_COUNT 2
#define PET_MAX_OUTPUTS 16
#define PET_MAX_SHEETS 16
#define PET_FRAME_INTERVAL_NS 16666667LL

typedef struct PetApp PetApp;

typedef struct {
  struct wl_output *object;
  uint32_t registry_name;
  int width;
  int height;
  int scale;
  char label[96];
} PetOutput;

typedef struct {
  struct wl_buffer *object;
  uint32_t *pixels;
  size_t bytes;
  int fd;
  int width;
  int height;
  int stride;
  int previous_x;
  int previous_y;
  int previous_width;
  int previous_height;
  bool busy;
} PetBuffer;

typedef struct {
  const PetAnimationSource *source;
  PetImage image;
} PetSheet;

struct PetApp {
  PetWaylandConfig config;
  struct wl_display *display;
  struct wl_registry *registry;
  struct wl_compositor *compositor;
  struct wl_shm *shm;
  struct wl_seat *seat;
  struct wl_pointer *pointer;
  struct zwlr_layer_shell_v1 *layer_shell;
  struct xdg_wm_base *xdg_wm_base;
  struct zxdg_decoration_manager_v1 *decoration_manager;
  struct wl_surface *surface;
  struct zwlr_layer_surface_v1 *layer_surface;
  struct xdg_surface *xdg_surface;
  struct xdg_toplevel *xdg_toplevel;
  struct zxdg_toplevel_decoration_v1 *decoration;
  struct wl_callback *frame_callback;
  PetOutput outputs[PET_MAX_OUTPUTS];
  int output_count;
  PetOutput *output;
  PetBuffer buffers[PET_BUFFER_COUNT];
  int width;
  int height;
  int requested_width;
  int requested_height;
  bool configured;
  bool running;
  bool use_layer_shell;
  bool click_through;
  bool needs_redraw;
  double pointer_x;
  double pointer_y;
  double press_x;
  double press_y;
  float press_pet_x;
  float press_pet_y;
  bool pointer_inside;
  bool pressed;
  bool drag_started;
  bool picking_up;
  bool special_animation;
  float scale;
  bool explicit_scale;
  float speed;
  const PetCharacter *character;
  size_t character_index;
  const PetVariant *variant;
  size_t variant_index;
  PetStateMachine state;
  PetMovement movement;
  bool movement_positioned;
  PetAnimationPlayer animation;
  PetSheet sheets[PET_MAX_SHEETS];
  int sheet_count;
};

static volatile sig_atomic_t signal_quit;
static volatile sig_atomic_t signal_click_through;
static volatile sig_atomic_t signal_auto_move;
static volatile sig_atomic_t signal_next_character;
static volatile sig_atomic_t signal_next_variant;
static volatile sig_atomic_t next_variant_signal_number;

static int minimum_int(int left, int right) { return left < right ? left : right; }
static int maximum_int(int left, int right) { return left > right ? left : right; }

static void destroy_pointer(struct wl_pointer *pointer) {
  if (!pointer) return;
  if (wl_proxy_get_version((struct wl_proxy *)pointer) >= WL_POINTER_RELEASE_SINCE_VERSION)
    wl_pointer_release(pointer);
  else
    wl_pointer_destroy(pointer);
}

static void destroy_seat(struct wl_seat *seat) {
  if (!seat) return;
  if (wl_proxy_get_version((struct wl_proxy *)seat) >= WL_SEAT_RELEASE_SINCE_VERSION)
    wl_seat_release(seat);
  else
    wl_seat_destroy(seat);
}

static int64_t monotonic_nanoseconds(void) {
  struct timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return (int64_t)time.tv_sec * 1000000000LL + time.tv_nsec;
}

static void on_signal(int number) {
  if (number == SIGUSR1) signal_click_through = 1;
  else if (number == SIGUSR2) signal_auto_move = 1;
  else if (number == SIGHUP) signal_next_character = 1;
  else if (number == next_variant_signal_number) signal_next_variant = 1;
  else signal_quit = 1;
}

static void install_signal_handlers(void) {
  struct sigaction action = { 0 };
  next_variant_signal_number = SIGRTMIN;
  action.sa_handler = on_signal;
  sigemptyset(&action.sa_mask);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGUSR1, &action, NULL);
  sigaction(SIGUSR2, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
  sigaction((int)next_variant_signal_number, &action, NULL);
}

static void output_geometry(void *data, struct wl_output *output, int32_t x, int32_t y,
                            int32_t physical_width, int32_t physical_height,
                            int32_t subpixel, const char *make, const char *model,
                            int32_t transform) {
  PetOutput *pet_output = data;
  (void)output;
  (void)x;
  (void)y;
  (void)physical_width;
  (void)physical_height;
  (void)subpixel;
  (void)transform;
  if (make && model) snprintf(pet_output->label, sizeof(pet_output->label), "%s %s", make, model);
}

static void output_mode(void *data, struct wl_output *output, uint32_t flags,
                        int32_t width, int32_t height, int32_t refresh) {
  PetOutput *pet_output = data;
  (void)output;
  (void)refresh;
  if ((flags & WL_OUTPUT_MODE_CURRENT) || pet_output->width == 0) {
    pet_output->width = width;
    pet_output->height = height;
  }
}

static void output_done(void *data, struct wl_output *output) {
  (void)data;
  (void)output;
}

static void output_scale(void *data, struct wl_output *output, int32_t factor) {
  PetOutput *pet_output = data;
  (void)output;
  pet_output->scale = factor > 0 ? factor : 1;
}

static const struct wl_output_listener output_listener = {
  .geometry = output_geometry,
  .mode = output_mode,
  .done = output_done,
  .scale = output_scale,
};

static void pointer_enter(void *data, struct wl_pointer *pointer, uint32_t serial,
                          struct wl_surface *surface, wl_fixed_t x, wl_fixed_t y) {
  PetApp *app = data;
  (void)surface;
  app->pointer_inside = true;
  app->pointer_x = wl_fixed_to_double(x);
  app->pointer_y = wl_fixed_to_double(y);
  wl_pointer_set_cursor(pointer, serial, NULL, 0, 0);
}

static void pointer_leave(void *data, struct wl_pointer *pointer, uint32_t serial,
                          struct wl_surface *surface) {
  PetApp *app = data;
  (void)pointer;
  (void)serial;
  (void)surface;
  app->pointer_inside = false;
}

static void pointer_motion(void *data, struct wl_pointer *pointer, uint32_t time,
                           wl_fixed_t x, wl_fixed_t y) {
  PetApp *app = data;
  (void)pointer;
  (void)time;
  app->pointer_x = wl_fixed_to_double(x);
  app->pointer_y = wl_fixed_to_double(y);
  if (!app->pressed) return;
  const double offset_x = app->pointer_x - app->press_x;
  const double offset_y = app->pointer_y - app->press_y;
  if (!app->drag_started && hypot(offset_x, offset_y) >= 4.0) {
    app->drag_started = true;
    app->picking_up = false;
  }
  if (app->drag_started) {
    pet_movement_drag(&app->movement, app->press_pet_x + (float)offset_x,
                      app->press_pet_y + (float)offset_y);
    app->needs_redraw = true;
  }
}

static void restart_animation(PetApp *app) {
  app->animation.definition = NULL;
  app->animation.finished = false;
  app->needs_redraw = true;
}

static void pointer_button(void *data, struct wl_pointer *pointer, uint32_t serial,
                           uint32_t time, uint32_t button, uint32_t state) {
  PetApp *app = data;
  (void)pointer;
  (void)serial;
  (void)time;
  if (button == BTN_LEFT && state == WL_POINTER_BUTTON_STATE_PRESSED) {
    app->pressed = true;
    app->drag_started = false;
    app->picking_up = true;
    app->special_animation = false;
    app->press_x = app->pointer_x;
    app->press_y = app->pointer_y;
    app->press_pet_x = app->movement.x;
    app->press_pet_y = app->movement.y;
    pet_state_machine_dispatch(&app->state, PET_EVENT_GRAB);
    restart_animation(app);
  } else if (button == BTN_LEFT && state == WL_POINTER_BUTTON_STATE_RELEASED && app->pressed) {
    app->pressed = false;
    app->picking_up = false;
    if (app->drag_started) pet_state_machine_dispatch(&app->state, PET_EVENT_RELEASE);
    else pet_state_machine_dispatch(&app->state, PET_EVENT_CLICK);
    app->drag_started = false;
    restart_animation(app);
  } else if (button == BTN_RIGHT && state == WL_POINTER_BUTTON_STATE_PRESSED) {
    app->special_animation = true;
    pet_state_machine_dispatch(&app->state, PET_EVENT_SPECIAL);
    restart_animation(app);
  } else if (button == BTN_MIDDLE && state == WL_POINTER_BUTTON_STATE_PRESSED) {
    pet_runtime_toggle_auto_move(&app->state, &app->config.auto_move);
    fprintf(stderr, "pet-ark: automatic movement %s\n", app->state.auto_move ? "enabled" : "disabled");
  }
}

static void pointer_axis(void *data, struct wl_pointer *pointer, uint32_t time,
                         uint32_t axis, wl_fixed_t value) {
  PetApp *app = data;
  (void)pointer;
  (void)time;
  if (axis != WL_POINTER_AXIS_VERTICAL_SCROLL) return;
  const float amount = wl_fixed_to_double(value) > 0.0 ? -0.1f : 0.1f;
  app->scale = fminf(3.0f, fmaxf(0.25f, app->scale + amount));
  app->needs_redraw = true;
  fprintf(stderr, "pet-ark: scale %.2f\n", app->scale);
}

static const struct wl_pointer_listener pointer_listener = {
  .enter = pointer_enter,
  .leave = pointer_leave,
  .motion = pointer_motion,
  .button = pointer_button,
  .axis = pointer_axis,
};

static void seat_capabilities(void *data, struct wl_seat *seat, uint32_t capabilities) {
  PetApp *app = data;
  if ((capabilities & WL_SEAT_CAPABILITY_POINTER) && !app->pointer) {
    app->pointer = wl_seat_get_pointer(seat);
    wl_pointer_add_listener(app->pointer, &pointer_listener, app);
  } else if (!(capabilities & WL_SEAT_CAPABILITY_POINTER) && app->pointer) {
    destroy_pointer(app->pointer);
    app->pointer = NULL;
  }
}

static void seat_name(void *data, struct wl_seat *seat, const char *name) {
  (void)data;
  (void)seat;
  (void)name;
}

static const struct wl_seat_listener seat_listener = {
  .capabilities = seat_capabilities,
  .name = seat_name,
};

static void wm_base_ping(void *data, struct xdg_wm_base *wm_base, uint32_t serial) {
  (void)data;
  xdg_wm_base_pong(wm_base, serial);
}

static const struct xdg_wm_base_listener wm_base_listener = {
  .ping = wm_base_ping,
};

static void registry_global(void *data, struct wl_registry *registry, uint32_t name,
                            const char *interface, uint32_t version) {
  PetApp *app = data;
  if (!strcmp(interface, wl_compositor_interface.name)) {
    app->compositor = wl_registry_bind(registry, name, &wl_compositor_interface,
                                       minimum_int((int)version, 4));
  } else if (!strcmp(interface, wl_shm_interface.name)) {
    app->shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
  } else if (!strcmp(interface, wl_seat_interface.name)) {
    app->seat = wl_registry_bind(registry, name, &wl_seat_interface,
                                 minimum_int((int)version, 5));
    wl_seat_add_listener(app->seat, &seat_listener, app);
  } else if (!strcmp(interface, wl_output_interface.name) && app->output_count < PET_MAX_OUTPUTS) {
    PetOutput *output = &app->outputs[app->output_count++];
    output->registry_name = name;
    output->scale = 1;
    snprintf(output->label, sizeof(output->label), "output-%d", app->output_count - 1);
    output->object = wl_registry_bind(registry, name, &wl_output_interface,
                                      minimum_int((int)version, 3));
    wl_output_add_listener(output->object, &output_listener, output);
  } else if (!strcmp(interface, zwlr_layer_shell_v1_interface.name)) {
    app->layer_shell = wl_registry_bind(registry, name, &zwlr_layer_shell_v1_interface,
                                        minimum_int((int)version, 4));
  } else if (!strcmp(interface, xdg_wm_base_interface.name)) {
    app->xdg_wm_base = wl_registry_bind(registry, name, &xdg_wm_base_interface,
                                        minimum_int((int)version, 6));
    xdg_wm_base_add_listener(app->xdg_wm_base, &wm_base_listener, app);
  } else if (!strcmp(interface, zxdg_decoration_manager_v1_interface.name)) {
    app->decoration_manager = wl_registry_bind(registry, name,
      &zxdg_decoration_manager_v1_interface, 1);
  }
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
  PetApp *app = data;
  (void)registry;
  for (int index = 0; index < app->output_count; index++) {
    if (app->outputs[index].registry_name == name && app->output == &app->outputs[index]) {
      app->running = false;
      break;
    }
  }
}

static const struct wl_registry_listener registry_listener = {
  .global = registry_global,
  .global_remove = registry_global_remove,
};

static void request_resize(PetApp *app, int width, int height) {
  if (width <= 0 && app->output) width = app->output->width / maximum_int(1, app->output->scale);
  if (height <= 0 && app->output) height = app->output->height / maximum_int(1, app->output->scale);
  if (width <= 0) width = 1280;
  if (height <= 0) height = 720;
  app->requested_width = width;
  app->requested_height = height;
  app->configured = true;
  app->needs_redraw = true;
}

static void layer_configure(void *data, struct zwlr_layer_surface_v1 *surface,
                            uint32_t serial, uint32_t width, uint32_t height) {
  PetApp *app = data;
  zwlr_layer_surface_v1_ack_configure(surface, serial);
  request_resize(app, (int)width, (int)height);
}

static void layer_closed(void *data, struct zwlr_layer_surface_v1 *surface) {
  PetApp *app = data;
  (void)surface;
  app->running = false;
}

static const struct zwlr_layer_surface_v1_listener layer_surface_listener = {
  .configure = layer_configure,
  .closed = layer_closed,
};

static void xdg_surface_configure(void *data, struct xdg_surface *surface, uint32_t serial) {
  PetApp *app = data;
  xdg_surface_ack_configure(surface, serial);
  request_resize(app, app->requested_width, app->requested_height);
}

static const struct xdg_surface_listener xdg_surface_listener = {
  .configure = xdg_surface_configure,
};

static void xdg_toplevel_configure(void *data, struct xdg_toplevel *toplevel,
                                   int32_t width, int32_t height, struct wl_array *states) {
  PetApp *app = data;
  (void)toplevel;
  (void)states;
  if (width > 0) app->requested_width = width;
  if (height > 0) app->requested_height = height;
}

static void xdg_toplevel_close(void *data, struct xdg_toplevel *toplevel) {
  PetApp *app = data;
  (void)toplevel;
  app->running = false;
}

static const struct xdg_toplevel_listener xdg_toplevel_listener = {
  .configure = xdg_toplevel_configure,
  .close = xdg_toplevel_close,
};

static void buffer_release(void *data, struct wl_buffer *object) {
  PetBuffer *buffer = data;
  (void)object;
  buffer->busy = false;
}

static const struct wl_buffer_listener buffer_listener = {
  .release = buffer_release,
};

static void frame_done(void *data, struct wl_callback *callback, uint32_t time) {
  PetApp *app = data;
  (void)time;
  if (app->frame_callback == callback) app->frame_callback = NULL;
  wl_callback_destroy(callback);
}

static const struct wl_callback_listener frame_listener = {
  .done = frame_done,
};

static void destroy_buffer(PetBuffer *buffer) {
  if (buffer->object) wl_buffer_destroy(buffer->object);
  if (buffer->pixels && buffer->bytes) munmap(buffer->pixels, buffer->bytes);
  if (buffer->fd >= 0) close(buffer->fd);
  *buffer = (PetBuffer) { .fd = -1 };
}

static bool create_buffer(PetApp *app, PetBuffer *buffer, int width, int height) {
  *buffer = (PetBuffer) { .fd = -1, .width = width, .height = height, .stride = width * 4 };
  buffer->bytes = (size_t)buffer->stride * height;
  buffer->fd = memfd_create("pet-ark-framebuffer", MFD_CLOEXEC);
  if (buffer->fd < 0 || ftruncate(buffer->fd, (off_t)buffer->bytes) < 0) {
    perror("pet-ark: shared memory");
    destroy_buffer(buffer);
    return false;
  }
  buffer->pixels = mmap(NULL, buffer->bytes, PROT_READ | PROT_WRITE, MAP_SHARED, buffer->fd, 0);
  if (buffer->pixels == MAP_FAILED) {
    buffer->pixels = NULL;
    perror("pet-ark: mmap");
    destroy_buffer(buffer);
    return false;
  }
  memset(buffer->pixels, 0, buffer->bytes);
  struct wl_shm_pool *pool = wl_shm_create_pool(app->shm, buffer->fd, (int32_t)buffer->bytes);
  buffer->object = wl_shm_pool_create_buffer(pool, 0, width, height, buffer->stride,
                                             WL_SHM_FORMAT_ARGB8888);
  wl_shm_pool_destroy(pool);
  if (!buffer->object) {
    destroy_buffer(buffer);
    return false;
  }
  wl_buffer_add_listener(buffer->object, &buffer_listener, buffer);
  return true;
}

static bool resize_buffers(PetApp *app) {
  if (!app->configured || app->requested_width <= 0 || app->requested_height <= 0) return false;
  if (app->width == app->requested_width && app->height == app->requested_height) return true;
  for (int index = 0; index < PET_BUFFER_COUNT; index++) {
    if (app->buffers[index].busy) return false;
  }
  for (int index = 0; index < PET_BUFFER_COUNT; index++) destroy_buffer(&app->buffers[index]);
  app->width = app->requested_width;
  app->height = app->requested_height;
  for (int index = 0; index < PET_BUFFER_COUNT; index++) {
    if (!create_buffer(app, &app->buffers[index], app->width, app->height)) return false;
  }
  app->needs_redraw = true;
  return true;
}

static void clear_sheets(PetApp *app) {
  for (int index = 0; index < app->sheet_count; index++) pet_image_destroy(&app->sheets[index].image);
  memset(app->sheets, 0, sizeof(app->sheets));
  app->sheet_count = 0;
}

static PetImage *load_sheet(PetApp *app, const PetAnimationSource *source) {
  for (int index = 0; index < app->sheet_count; index++) {
    if (app->sheets[index].source == source) return &app->sheets[index].image;
  }
  if (app->sheet_count >= PET_MAX_SHEETS) return NULL;
  char path[PATH_MAX];
  if (snprintf(path, sizeof(path), "%s/%s", app->config.assets_root, source->sheet) >= (int)sizeof(path)) {
    fprintf(stderr, "pet-ark: asset path is too long\n");
    return NULL;
  }
  PetSheet *sheet = &app->sheets[app->sheet_count];
  if (pet_image_load_png(&sheet->image, path) != 0) {
    fprintf(stderr, "pet-ark: cannot load sprite atlas %s\n", path);
    return NULL;
  }
  sheet->source = source;
  app->sheet_count++;
  return &sheet->image;
}

static const PetAnimationDefinition *desired_animation(PetApp *app) {
  const char *id = NULL;
  if (app->picking_up) id = "picked-up";
  else if (app->special_animation && app->state.behavior == PET_BEHAVIOR_INTERACTION) id = "special";
  else id = pet_state_machine_animation(&app->state, app->movement.direction);
  PetAnimationResolution resolution;
  if (!pet_character_resolve_animation(app->character, app->variant, id, &resolution)) {
    fprintf(stderr, "pet-ark: state '%s' is unresolved for %s/%s\n",
            id, app->character->id, app->variant->id);
    return NULL;
  }
  return resolution.animation;
}

static bool current_frame_geometry(PetApp *app, PetImage **image, int *source_x, int *source_y,
                                   int *frame_width, int *frame_height, int *draw_width,
                                   int *draw_height, bool *mirror) {
  if (!app->animation.definition) return false;
  PetImage *sheet = load_sheet(app, app->animation.definition->source);
  if (!sheet) return false;
  const PetAnimationSource *source = app->animation.definition->source;
  if (source->columns <= 0 || source->rows <= 0) return false;
  const int width = sheet->width / source->columns;
  const int height = sheet->height / source->rows;
  const int frame = pet_animation_source_frame(&app->animation);
  *image = sheet;
  *source_x = (frame % source->columns) * width;
  *source_y = (frame / source->columns) * height;
  *frame_width = width;
  *frame_height = height;
  *draw_width = maximum_int(1, (int)lroundf(width * app->scale));
  *draw_height = maximum_int(1, (int)lroundf(height * app->scale));
  *mirror = app->animation.definition->mirror;
  return true;
}

static void clear_rectangle(PetBuffer *buffer, int x, int y, int width, int height) {
  const int left = maximum_int(0, x);
  const int top = maximum_int(0, y);
  const int right = minimum_int(buffer->width, x + width);
  const int bottom = minimum_int(buffer->height, y + height);
  for (int row = top; row < bottom; row++) {
    memset(buffer->pixels + (size_t)row * buffer->width + left, 0,
           (size_t)maximum_int(0, right - left) * sizeof(uint32_t));
  }
}

static void draw_sprite(PetBuffer *buffer, const PetImage *image, int source_x, int source_y,
                        int source_width, int source_height, int destination_x, int destination_y,
                        int destination_width, int destination_height, bool mirror) {
  const int left = maximum_int(0, destination_x);
  const int top = maximum_int(0, destination_y);
  const int right = minimum_int(buffer->width, destination_x + destination_width);
  const int bottom = minimum_int(buffer->height, destination_y + destination_height);
  for (int y = top; y < bottom; y++) {
    int frame_y = (int)(((int64_t)(y - destination_y) * source_height) / destination_height);
    frame_y = minimum_int(source_height - 1, maximum_int(0, frame_y));
    uint32_t *destination = buffer->pixels + (size_t)y * buffer->width;
    const uint32_t *source = image->pixels + (size_t)(source_y + frame_y) * image->width;
    for (int x = left; x < right; x++) {
      int frame_x = (int)(((int64_t)(x - destination_x) * source_width) / destination_width);
      frame_x = minimum_int(source_width - 1, maximum_int(0, frame_x));
      if (mirror) frame_x = source_width - 1 - frame_x;
      destination[x] = source[source_x + frame_x];
    }
  }
}

static void set_input_region(PetApp *app, int draw_x, int draw_y, int frame_width,
                             int draw_width, int draw_height, bool mirror) {
  struct wl_region *region = wl_compositor_create_region(app->compositor);
  if (!app->click_through) {
    const PetHitbox *hitbox = pet_animation_hitbox(&app->animation);
    if (hitbox && frame_width > 0) {
      const int hitbox_x = mirror ? frame_width - hitbox->x - hitbox->width : hitbox->x;
      const int x = draw_x + (int)floorf(hitbox_x * app->scale);
      const int y = draw_y + (int)floorf(hitbox->y * app->scale);
      const int width = maximum_int(1, (int)ceilf(hitbox->width * app->scale));
      const int height = maximum_int(1, (int)ceilf(hitbox->height * app->scale));
      wl_region_add(region, x, y, width, height);
    } else {
      wl_region_add(region, draw_x, draw_y, draw_width, draw_height);
    }
  }
  wl_surface_set_input_region(app->surface, region);
  wl_region_destroy(region);
}

static PetBuffer *available_buffer(PetApp *app) {
  for (int index = 0; index < PET_BUFFER_COUNT; index++) {
    if (app->buffers[index].object && !app->buffers[index].busy) return &app->buffers[index];
  }
  return NULL;
}

static bool render(PetApp *app) {
  if (app->frame_callback) return false;
  if (!resize_buffers(app)) return false;
  PetBuffer *buffer = available_buffer(app);
  if (!buffer) return false;
  PetImage *image = NULL;
  int source_x = 0;
  int source_y = 0;
  int frame_width = 0;
  int frame_height = 0;
  int draw_width = 0;
  int draw_height = 0;
  bool mirror = false;
  if (!current_frame_geometry(app, &image, &source_x, &source_y, &frame_width,
                              &frame_height, &draw_width, &draw_height, &mirror)) return false;

  if (app->movement.surface_width != app->width || app->movement.surface_height != app->height ||
      app->movement.sprite_width != draw_width || app->movement.sprite_height != draw_height) {
    pet_movement_set_bounds(&app->movement, app->width, app->height, draw_width, draw_height);
  }
  if (!app->movement_positioned) {
    app->movement.x = fmaxf(0.0f, (app->width - draw_width) * 0.65f);
    app->movement_positioned = true;
  }
  const int draw_x = (int)lroundf(app->movement.x);
  const int draw_y = (int)lroundf(app->movement.y);
  const int previous_x = buffer->previous_x;
  const int previous_y = buffer->previous_y;
  const int previous_width = buffer->previous_width;
  const int previous_height = buffer->previous_height;
  clear_rectangle(buffer, buffer->previous_x, buffer->previous_y,
                  buffer->previous_width, buffer->previous_height);
  draw_sprite(buffer, image, source_x, source_y, frame_width, frame_height,
              draw_x, draw_y, draw_width, draw_height, mirror);
  buffer->previous_x = draw_x;
  buffer->previous_y = draw_y;
  buffer->previous_width = draw_width;
  buffer->previous_height = draw_height;
  set_input_region(app, draw_x, draw_y, frame_width, draw_width, draw_height, mirror);
  app->frame_callback = wl_surface_frame(app->surface);
  if (!app->frame_callback ||
      wl_callback_add_listener(app->frame_callback, &frame_listener, app) < 0) {
    if (app->frame_callback) wl_callback_destroy(app->frame_callback);
    app->frame_callback = NULL;
    fprintf(stderr, "pet-ark: cannot create Wayland frame callback\n");
    return false;
  }
  wl_surface_attach(app->surface, buffer->object, 0, 0);
  wl_surface_damage(app->surface, previous_x, previous_y, previous_width, previous_height);
  wl_surface_damage(app->surface, draw_x, draw_y, draw_width, draw_height);
  wl_surface_commit(app->surface);
  buffer->busy = true;
  app->needs_redraw = false;
  return true;
}

static bool variant_assets_available(const PetApp *app, const PetVariant *variant) {
  char path[PATH_MAX];
  return app->config.assets_root && variant && variant->assets_subdir &&
         snprintf(path, sizeof(path), "%s/%s", app->config.assets_root,
                  variant->assets_subdir) < (int)sizeof(path) &&
         access(path, R_OK | X_OK) == 0;
}

static bool apply_selection(PetApp *app, size_t character_index, size_t variant_index,
                            bool first) {
  if (character_index >= PET_CHARACTER_COUNT) return false;
  const PetCharacter *character = &PET_CHARACTERS[character_index];
  if (variant_index >= character->variant_count) return false;
  const PetVariant *variant = &character->variants[variant_index];
  if (!variant_assets_available(app, variant)) {
    fprintf(stderr, "pet-ark: runtime assets unavailable for %s/%s\n",
            character->id, variant->id);
    return false;
  }
  const float previous_x = app->movement.x;
  const float previous_y = app->movement.y;
  app->character_index = character_index;
  app->character = character;
  app->variant_index = variant_index;
  app->variant = variant;
  app->config.character_id = character->id;
  app->config.skin_id = variant->id;
  app->pressed = false;
  app->drag_started = false;
  app->picking_up = false;
  app->special_animation = false;
  clear_sheets(app);
  if (!app->explicit_scale) app->scale = app->variant->default_scale;
  app->scale = fminf(3.0f, fmaxf(0.25f, app->scale));
  pet_state_machine_init(&app->state, (uint32_t)(time(NULL) ^ getpid()),
                         app->character->idle_min_seconds, app->character->idle_max_seconds,
                         app->character->rest_after_seconds);
  pet_runtime_set_auto_move(&app->state, &app->config.auto_move, app->config.auto_move);
  pet_movement_init(&app->movement, (uint32_t)(time(NULL) + app->character_index * 7919));
  app->movement.speed_multiplier = app->speed;
  if (!first) {
    app->movement.x = previous_x;
    app->movement.y = previous_y;
  }
  app->movement_positioned = !first;
  memset(&app->animation, 0, sizeof(app->animation));
  PetAnimationResolution idle;
  if (!pet_character_resolve_animation(app->character, app->variant, "idle", &idle)) {
    fprintf(stderr, "pet-ark: %s/%s has no resolvable idle animation\n",
            app->character->id, app->variant->id);
    return false;
  }
  pet_animation_set(&app->animation, idle.animation);
  if (app->width > 0 && first) {
    PetImage *image = NULL;
    int sx, sy, fw, fh, dw, dh;
    bool mirror;
    if (current_frame_geometry(app, &image, &sx, &sy, &fw, &fh, &dw, &dh, &mirror)) {
      pet_movement_set_bounds(&app->movement, app->width, app->height, dw, dh);
      app->movement.x = fmaxf(0.0f, (app->width - dw) * 0.65f);
      app->movement_positioned = true;
    }
  }
  app->needs_redraw = true;
  fprintf(stderr, "pet-ark: character %s (%s), skin %s (%s)\n",
          app->character->id, app->character->localized_name,
          app->variant->id, app->variant->localized_name);
  return true;
}

static bool select_next_character(PetApp *app) {
  for (size_t offset = 1; offset <= PET_CHARACTER_COUNT; offset++) {
    const size_t index = (app->character_index + offset) % PET_CHARACTER_COUNT;
    const PetCharacter *character = &PET_CHARACTERS[index];
    const PetVariant *variant = pet_character_default_variant(character);
    if (variant && variant_assets_available(app, variant))
      return apply_selection(app, index, (size_t)(variant - character->variants), false);
  }
  return false;
}

static bool select_next_variant(PetApp *app) {
  if (!app->character || app->character->variant_count == 0) return false;
  for (size_t offset = 1; offset <= app->character->variant_count; offset++) {
    const size_t index = (app->variant_index + offset) % app->character->variant_count;
    const PetVariant *variant = &app->character->variants[index];
    if (variant_assets_available(app, variant))
      return apply_selection(app, app->character_index, index, false);
  }
  return false;
}

static void update_runtime_controls(PetApp *app) {
  if (signal_quit) app->running = false;
  if (signal_click_through) {
    signal_click_through = 0;
    app->click_through = !app->click_through;
    app->needs_redraw = true;
    fprintf(stderr, "pet-ark: click-through %s\n", app->click_through ? "enabled" : "disabled");
  }
  if (signal_auto_move) {
    signal_auto_move = 0;
    pet_runtime_toggle_auto_move(&app->state, &app->config.auto_move);
    fprintf(stderr, "pet-ark: automatic movement %s\n", app->state.auto_move ? "enabled" : "disabled");
  }
  if (signal_next_character) {
    signal_next_character = 0;
    if (!select_next_character(app)) fprintf(stderr, "pet-ark: no selectable character assets\n");
  }
  if (signal_next_variant) {
    signal_next_variant = 0;
    if (!select_next_variant(app)) fprintf(stderr, "pet-ark: no selectable skin assets\n");
  }
}

static void tick(PetApp *app, float delta) {
  const PetVisualSnapshot before = {
    .animation_definition = app->animation.definition,
    .source_frame = pet_animation_source_frame(&app->animation),
    .draw_x = (int)lroundf(app->movement.x),
    .draw_y = (int)lroundf(app->movement.y),
  };
  update_runtime_controls(app);
  if (!app->running || !app->configured || !app->character) return;
  const PetBehavior previous_behavior = app->state.behavior;
  const bool animation_finished = pet_animation_tick(&app->animation, delta);
  if (app->picking_up && animation_finished) {
    app->picking_up = false;
    restart_animation(app);
  }
  bool movement_finished = false;
  if (app->state.behavior == PET_BEHAVIOR_MOVEMENT) {
    const float base_speed = app->state.running ? app->character->run_speed : app->character->walk_speed;
    movement_finished = pet_movement_tick(&app->movement, delta, base_speed);
  }
  bool transition_finished = animation_finished;
  if (app->state.behavior == PET_BEHAVIOR_DROPPED && app->movement.surface_height > 0) {
    const float ground = fmaxf(0.0f, app->movement.surface_height -
      app->movement.sprite_height - 16.0f);
    app->movement.y = fminf(ground, app->movement.y + 900.0f * delta);
    if (app->movement.y + 0.5f < ground) transition_finished = false;
  }
  pet_state_machine_tick(&app->state, delta, transition_finished, movement_finished);
  if (previous_behavior != PET_BEHAVIOR_MOVEMENT && app->state.behavior == PET_BEHAVIOR_MOVEMENT) {
    pet_movement_choose_target(&app->movement);
  }
  if (previous_behavior == PET_BEHAVIOR_INTERACTION && app->state.behavior != PET_BEHAVIOR_INTERACTION) {
    app->special_animation = false;
  }
  const PetAnimationDefinition *definition = desired_animation(app);
  pet_animation_set(&app->animation, definition);
  const PetVisualSnapshot after = {
    .animation_definition = app->animation.definition,
    .source_frame = pet_animation_source_frame(&app->animation),
    .draw_x = (int)lroundf(app->movement.x),
    .draw_y = (int)lroundf(app->movement.y),
  };
  if (pet_visual_snapshot_changed(&before, &after)) app->needs_redraw = true;
}

static bool create_surface(PetApp *app) {
  app->surface = wl_compositor_create_surface(app->compositor);
  if (!app->surface) return false;
  const PetShellMode shell_mode = pet_shell_mode(
    app->layer_shell != NULL, app->xdg_wm_base != NULL,
    app->config.xdg_fullscreen_fallback);
  if (shell_mode == PET_SHELL_LAYER) {
    app->use_layer_shell = true;
    app->layer_surface = zwlr_layer_shell_v1_get_layer_surface(
      app->layer_shell, app->surface, app->output ? app->output->object : NULL,
      ZWLR_LAYER_SHELL_V1_LAYER_TOP, "pet-ark");
    zwlr_layer_surface_v1_add_listener(app->layer_surface, &layer_surface_listener, app);
    zwlr_layer_surface_v1_set_size(app->layer_surface, 0, 0);
    zwlr_layer_surface_v1_set_anchor(app->layer_surface,
      ZWLR_LAYER_SURFACE_V1_ANCHOR_TOP | ZWLR_LAYER_SURFACE_V1_ANCHOR_RIGHT |
      ZWLR_LAYER_SURFACE_V1_ANCHOR_BOTTOM | ZWLR_LAYER_SURFACE_V1_ANCHOR_LEFT);
    zwlr_layer_surface_v1_set_exclusive_zone(app->layer_surface, -1);
    zwlr_layer_surface_v1_set_keyboard_interactivity(
      app->layer_surface, ZWLR_LAYER_SURFACE_V1_KEYBOARD_INTERACTIVITY_NONE);
  } else if (shell_mode == PET_SHELL_XDG_FULLSCREEN) {
    app->use_layer_shell = false;
    app->xdg_surface = xdg_wm_base_get_xdg_surface(app->xdg_wm_base, app->surface);
    xdg_surface_add_listener(app->xdg_surface, &xdg_surface_listener, app);
    app->xdg_toplevel = xdg_surface_get_toplevel(app->xdg_surface);
    xdg_toplevel_add_listener(app->xdg_toplevel, &xdg_toplevel_listener, app);
    xdg_toplevel_set_title(app->xdg_toplevel, "Pet Ark");
    xdg_toplevel_set_app_id(app->xdg_toplevel, "io.github.petark.desktop");
    if (app->decoration_manager) {
      app->decoration = zxdg_decoration_manager_v1_get_toplevel_decoration(
        app->decoration_manager, app->xdg_toplevel);
      zxdg_toplevel_decoration_v1_set_mode(
        app->decoration, ZXDG_TOPLEVEL_DECORATION_V1_MODE_CLIENT_SIDE);
    }
    xdg_toplevel_set_fullscreen(app->xdg_toplevel, app->output ? app->output->object : NULL);
  } else {
    if (app->xdg_wm_base && !app->config.xdg_fullscreen_fallback) {
      fprintf(stderr,
        "pet-ark: compositor does not expose wlr-layer-shell; refusing the xdg-shell "
        "fullscreen fallback by default\n"
        "pet-ark: pass --xdg-fullscreen-fallback to opt in after compositor-specific testing\n");
    } else {
      fprintf(stderr, "pet-ark: compositor exposes neither wlr-layer-shell nor xdg-shell\n");
    }
    return false;
  }
  struct wl_region *empty = wl_compositor_create_region(app->compositor);
  wl_surface_set_input_region(app->surface, empty);
  wl_region_destroy(empty);
  wl_surface_commit(app->surface);
  return true;
}

static bool initialize_wayland(PetApp *app) {
  app->display = wl_display_connect(NULL);
  if (!app->display) {
    fprintf(stderr, "pet-ark: cannot connect to Wayland (check WAYLAND_DISPLAY)\n");
    return false;
  }
  app->registry = wl_display_get_registry(app->display);
  wl_registry_add_listener(app->registry, &registry_listener, app);
  if (wl_display_roundtrip(app->display) < 0 || wl_display_roundtrip(app->display) < 0) return false;
  if (!app->compositor || !app->shm) {
    fprintf(stderr, "pet-ark: compositor does not provide wl_compositor and wl_shm\n");
    return false;
  }
  if (app->config.monitor >= app->output_count) {
    fprintf(stderr, "pet-ark: monitor %d unavailable; compositor reported %d output(s)\n",
            app->config.monitor, app->output_count);
    return false;
  }
  if (app->output_count > 0) app->output = &app->outputs[app->config.monitor];
  if (app->config.verbose) {
    fprintf(stderr, "pet-ark: %d Wayland output(s)\n", app->output_count);
    for (int index = 0; index < app->output_count; index++) {
      fprintf(stderr, "  [%d] %s %dx%d scale=%d%s\n", index, app->outputs[index].label,
              app->outputs[index].width, app->outputs[index].height, app->outputs[index].scale,
              app->output == &app->outputs[index] ? " selected" : "");
    }
  }
  return true;
}

static bool path_has_variant(const char *root, const PetVariant *variant) {
  char path[PATH_MAX];
  return root && variant && variant->assets_subdir &&
         snprintf(path, sizeof(path), "%s/%s", root, variant->assets_subdir) < (int)sizeof(path) &&
         access(path, R_OK | X_OK) == 0;
}

static bool resolve_assets_root(PetApp *app, char resolved[PATH_MAX]) {
  const char *environment = getenv("PET_ARK_ASSETS");
  const char *candidates[] = {
    app->config.assets_root,
    environment,
    "standalone/assets/runtime",
    "standalone/dist/characters",
    "assets/runtime",
    "characters",
  };
  for (size_t index = 0; index < sizeof(candidates) / sizeof(candidates[0]); index++) {
    if (path_has_variant(candidates[index], app->variant)) {
      snprintf(resolved, PATH_MAX, "%s", candidates[index]);
      return true;
    }
  }
  char executable[PATH_MAX];
  const ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
  if (length > 0) {
    executable[length] = '\0';
    char *slash = strrchr(executable, '/');
    if (slash) {
      *slash = '\0';
      char candidate[PATH_MAX];
      if (snprintf(candidate, sizeof(candidate), "%s/../characters", executable) < (int)sizeof(candidate) &&
          path_has_variant(candidate, app->variant)) {
        snprintf(resolved, PATH_MAX, "%s", candidate);
        return true;
      }
    }
  }
  return false;
}

static void destroy_app(PetApp *app) {
  clear_sheets(app);
  for (int index = 0; index < PET_BUFFER_COUNT; index++) destroy_buffer(&app->buffers[index]);
  if (app->frame_callback) wl_callback_destroy(app->frame_callback);
  if (app->decoration) zxdg_toplevel_decoration_v1_destroy(app->decoration);
  if (app->xdg_toplevel) xdg_toplevel_destroy(app->xdg_toplevel);
  if (app->xdg_surface) xdg_surface_destroy(app->xdg_surface);
  if (app->layer_surface) zwlr_layer_surface_v1_destroy(app->layer_surface);
  if (app->surface) wl_surface_destroy(app->surface);
  destroy_pointer(app->pointer);
  destroy_seat(app->seat);
  for (int index = 0; index < app->output_count; index++) {
    if (app->outputs[index].object) wl_output_destroy(app->outputs[index].object);
  }
  if (app->decoration_manager) zxdg_decoration_manager_v1_destroy(app->decoration_manager);
  if (app->xdg_wm_base) xdg_wm_base_destroy(app->xdg_wm_base);
  if (app->layer_shell) zwlr_layer_shell_v1_destroy(app->layer_shell);
  if (app->shm) wl_shm_destroy(app->shm);
  if (app->compositor) wl_compositor_destroy(app->compositor);
  if (app->registry) wl_registry_destroy(app->registry);
  if (app->display) wl_display_disconnect(app->display);
}

int pet_wayland_probe(void) {
  PetApp app = { 0 };
  for (int index = 0; index < PET_BUFFER_COUNT; index++) app.buffers[index].fd = -1;
  app.config.monitor = 0;
  if (!initialize_wayland(&app)) {
    destroy_app(&app);
    return 1;
  }
  printf("wayland: connected\noutputs: %d\nlayer-shell: %s\nxdg-shell: %s\n"
         "xdg-fullscreen-fallback: explicit-opt-in\n",
         app.output_count, app.layer_shell ? "yes" : "no", app.xdg_wm_base ? "yes" : "no");
  destroy_app(&app);
  return 0;
}

int pet_wayland_run(const PetWaylandConfig *config) {
  PetApp app = { 0 };
  char assets_root[PATH_MAX];
  if (PET_CHARACTER_COUNT == 0) {
    fprintf(stderr, "pet-ark: character registry is empty\n");
    return 2;
  }
  for (int index = 0; index < PET_BUFFER_COUNT; index++) app.buffers[index].fd = -1;
  app.config = *config;
  app.click_through = config->click_through;
  app.explicit_scale = config->scale > 0.0f;
  app.scale = app.explicit_scale ? config->scale : 1.0f;
  app.speed = config->speed > 0.0f ? config->speed : 1.0f;
  app.running = true;
  const PetCharacter *character = config->character_id
    ? pet_character_find(config->character_id)
    : &PET_CHARACTERS[0];
  if (!character) {
    fprintf(stderr, "pet-ark: unknown character '%s'\n", config->character_id);
    return 2;
  }
  const PetVariant *variant = config->skin_id
    ? pet_character_variant(character, config->skin_id)
    : pet_character_default_variant(character);
  if (!variant) {
    fprintf(stderr, "pet-ark: unknown skin '%s' for character '%s'\n",
            config->skin_id ? config->skin_id : "(default)", character->id);
    return 2;
  }
  app.character = character;
  app.character_index = (size_t)(character - PET_CHARACTERS);
  app.variant = variant;
  app.variant_index = (size_t)(variant - character->variants);
  if (!resolve_assets_root(&app, assets_root)) {
    fprintf(stderr, "pet-ark: runtime assets for %s/%s not found; pass --assets DIR\n",
            character->id, variant->id);
    return 1;
  }
  app.config.assets_root = assets_root;
  if (!initialize_wayland(&app) || !create_surface(&app)) {
    destroy_app(&app);
    return 1;
  }
  fprintf(stderr, "pet-ark: using %s%s\n",
          app.use_layer_shell ? "wlr-layer-shell" : "xdg-shell fullscreen fallback",
          app.use_layer_shell ? "" : " (explicit opt-in; compositor policy applies)");
  if (!apply_selection(&app, app.character_index, app.variant_index, true)) {
    destroy_app(&app);
    return 1;
  }
  install_signal_handlers();
  if (wl_display_roundtrip(app.display) < 0) {
    destroy_app(&app);
    return 1;
  }

  int64_t previous = monotonic_nanoseconds();
  bool display_error = false;
  while (app.running) {
    const int64_t now = monotonic_nanoseconds();
    float delta = (float)(now - previous) / 1000000000.0f;
    if (delta < 0.0f) delta = 0.0f;
    if (delta > 0.1f) delta = 0.1f;
    previous = now;
    tick(&app, delta);
    if (app.needs_redraw) render(&app);
    if (wl_display_dispatch_pending(app.display) < 0) {
      display_error = true;
      break;
    }
    const int flush_result = wl_display_flush(app.display);
    if (flush_result < 0 && errno != EAGAIN) {
      display_error = true;
      break;
    }
    struct pollfd descriptor = {
      .fd = wl_display_get_fd(app.display),
      .events = POLLIN | (flush_result < 0 ? POLLOUT : 0),
    };
    const int result = poll(&descriptor, 1, (int)(PET_FRAME_INTERVAL_NS / 1000000LL));
    if (result < 0 && errno != EINTR) {
      display_error = true;
      break;
    }
    if (result > 0 && (descriptor.revents & POLLIN) && wl_display_dispatch(app.display) < 0) {
      display_error = true;
      break;
    }
    if (result > 0 && (descriptor.revents & (POLLERR | POLLHUP))) {
      display_error = true;
      break;
    }
  }
  destroy_app(&app);
  return display_error ? 1 : 0;
}
