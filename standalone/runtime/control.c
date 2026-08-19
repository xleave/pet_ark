#define _GNU_SOURCE

#include "control.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

static void set_error(char *error, size_t size, const char *message) {
  if (error && size > 0) snprintf(error, size, "%s", message);
}

static const char *json_value(const char *json, const char *key) {
  char needle[80];
  if (!json || !key || snprintf(needle, sizeof(needle), "\"%s\"", key) >= (int)sizeof(needle))
    return NULL;
  const char *value = strstr(json, needle);
  if (!value) return NULL;
  value += strlen(needle);
  while (isspace((unsigned char)*value)) value++;
  if (*value++ != ':') return NULL;
  while (isspace((unsigned char)*value)) value++;
  return value;
}

static bool json_string(const char *json, const char *key, char *output, size_t size) {
  const char *value = json_value(json, key);
  if (!value || *value++ != '"' || size == 0) return false;
  size_t length = 0;
  while (*value && *value != '"') {
    const unsigned char byte = (unsigned char)*value++;
    if (byte == '\\' || byte < 0x20 || length + 1 >= size) return false;
    output[length++] = (char)byte;
  }
  if (*value != '"') return false;
  output[length] = '\0';
  return true;
}

static bool json_number(const char *json, const char *key, float *output) {
  const char *value = json_value(json, key);
  if (!value) return false;
  char *end = NULL;
  errno = 0;
  const float parsed = strtof(value, &end);
  if (errno || end == value || !isfinite(parsed)) return false;
  while (isspace((unsigned char)*end)) end++;
  if (*end != ',' && *end != '}') return false;
  *output = parsed;
  return true;
}

static bool json_boolean(const char *json, const char *key, bool *output) {
  const char *value = json_value(json, key);
  if (!value) return false;
  if (!strncmp(value, "true", 4) && (value[4] == ',' || value[4] == '}' || isspace((unsigned char)value[4]))) {
    *output = true;
    return true;
  }
  if (!strncmp(value, "false", 5) && (value[5] == ',' || value[5] == '}' || isspace((unsigned char)value[5]))) {
    *output = false;
    return true;
  }
  return false;
}

static bool safe_id(const char *value) {
  if (!value || !*value) return false;
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) {
    if (!isalnum(*cursor) && *cursor != '-' && *cursor != '_' && *cursor != '.') return false;
  }
  return true;
}

bool pet_control_parse(const char *json, PetControlCommand *command,
                       char *error, size_t error_size) {
  char name[48];
  if (!json || !command) {
    set_error(error, error_size, "empty request");
    return false;
  }
  memset(command, 0, sizeof(*command));
  if (!json_string(json, "command", name, sizeof(name))) {
    set_error(error, error_size, "missing command");
    return false;
  }
  if (!strcmp(name, "get_status")) {
    command->kind = PET_CONTROL_GET_STATUS;
    return true;
  }
  if (!strcmp(name, "set_scale") || !strcmp(name, "set_speed")) {
    if (!json_number(json, "value", &command->number)) {
      set_error(error, error_size, "missing numeric value");
      return false;
    }
    const float minimum = !strcmp(name, "set_scale") ? 0.25f : 0.1f;
    const float maximum = !strcmp(name, "set_scale") ? 3.0f : 5.0f;
    if (command->number < minimum || command->number > maximum) {
      set_error(error, error_size, !strcmp(name, "set_scale")
        ? "scale must be between 0.25 and 3.0"
        : "speed must be between 0.1 and 5.0");
      return false;
    }
    command->kind = !strcmp(name, "set_scale") ? PET_CONTROL_SET_SCALE : PET_CONTROL_SET_SPEED;
    return true;
  }
  if (!strcmp(name, "set_auto_move") || !strcmp(name, "set_click_through")) {
    if (!json_boolean(json, "value", &command->boolean)) {
      set_error(error, error_size, "missing boolean value");
      return false;
    }
    command->kind = !strcmp(name, "set_auto_move")
      ? PET_CONTROL_SET_AUTO_MOVE : PET_CONTROL_SET_CLICK_THROUGH;
    return true;
  }
  if (!strcmp(name, "select")) {
    if (!json_string(json, "character", command->character, sizeof(command->character)) ||
        !safe_id(command->character)) {
      set_error(error, error_size, "invalid character id");
      return false;
    }
    const char *variant = json_value(json, "variant");
    if (variant && (!json_string(json, "variant", command->variant, sizeof(command->variant)) ||
                    !safe_id(command->variant))) {
      set_error(error, error_size, "invalid variant id");
      return false;
    }
    command->kind = PET_CONTROL_SELECT;
    return true;
  }
  if (!strcmp(name, "react")) {
    if (!json_string(json, "event", command->event, sizeof(command->event)) ||
        (strcmp(command->event, "attention") && strcmp(command->event, "celebrate") &&
         strcmp(command->event, "wake"))) {
      set_error(error, error_size, "reaction must be attention, celebrate, or wake");
      return false;
    }
    command->kind = PET_CONTROL_REACT;
    return true;
  }
  if (!strcmp(name, "quit")) {
    command->kind = PET_CONTROL_QUIT;
    return true;
  }
  set_error(error, error_size, "unknown command");
  return false;
}

static bool bind_socket(int fd, const struct sockaddr_un *address, socklen_t size) {
  if (bind(fd, (const struct sockaddr *)address, size) == 0) return true;
  if (errno != EADDRINUSE) return false;

  const int probe = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (probe >= 0) {
    const int connected = connect(probe, (const struct sockaddr *)address, size);
    close(probe);
    if (connected == 0) {
      errno = EADDRINUSE;
      return false;
    }
  }
  if (unlink(address->sun_path) < 0 && errno != ENOENT) return false;
  return bind(fd, (const struct sockaddr *)address, size) == 0;
}

bool pet_control_server_open(PetControlServer *server, const char *requested_path,
                             const char *instance_id,
                             char *error, size_t error_size) {
  if (!server) return false;
  server->fd = -1;
  server->path[0] = '\0';

  char default_directory[108];
  const char *path = requested_path;
  if (!path || !*path) {
    const char *runtime = getenv("XDG_RUNTIME_DIR");
    if (!runtime || !*runtime ||
        snprintf(default_directory, sizeof(default_directory), "%s/pet-ark", runtime) >=
          (int)sizeof(default_directory)) {
      set_error(error, error_size, "XDG_RUNTIME_DIR is unavailable");
      return false;
    }
    if (mkdir(default_directory, 0700) < 0 && errno != EEXIST) {
      set_error(error, error_size, "cannot create control directory");
      return false;
    }
    static char default_path[108];
    const char *socket_name = instance_id && *instance_id && strcmp(instance_id, "default")
      ? instance_id : "control";
    if (snprintf(default_path, sizeof(default_path), "%s/%s.sock", default_directory, socket_name) >=
        (int)sizeof(default_path)) {
      set_error(error, error_size, "control socket path is too long");
      return false;
    }
    path = default_path;
  }
  if (strlen(path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    set_error(error, error_size, "control socket path is too long");
    return false;
  }

  const int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
  if (fd < 0) {
    set_error(error, error_size, "cannot create control socket");
    return false;
  }
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", path);
  const socklen_t address_size = (socklen_t)(sizeof(address.sun_family) + strlen(address.sun_path) + 1);
  if (!bind_socket(fd, &address, address_size) || listen(fd, 8) < 0 || chmod(path, 0600) < 0) {
    const int saved_errno = errno;
    close(fd);
    errno = saved_errno;
    set_error(error, error_size, errno == EADDRINUSE
      ? "another pet-ark control server is running" : "cannot bind control socket");
    return false;
  }
  server->fd = fd;
  snprintf(server->path, sizeof(server->path), "%s", path);
  return true;
}

void pet_control_server_close(PetControlServer *server) {
  if (!server) return;
  if (server->fd >= 0) close(server->fd);
  if (server->path[0]) unlink(server->path);
  server->fd = -1;
  server->path[0] = '\0';
}

void pet_control_reply(int client_fd, const char *json) {
  if (client_fd < 0) return;
  if (json) {
    send(client_fd, json, strlen(json), MSG_NOSIGNAL);
    send(client_fd, "\n", 1, MSG_NOSIGNAL);
  }
  close(client_fd);
}

int pet_control_server_receive(PetControlServer *server, PetControlCommand *command) {
  if (!server || server->fd < 0) return -1;
  const int client = accept4(server->fd, NULL, NULL, SOCK_CLOEXEC);
  if (client < 0) return -1;
  const struct timeval timeout = { .tv_sec = 0, .tv_usec = 200000 };
  setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
  char message[PET_CONTROL_MESSAGE_MAX];
  const ssize_t length = recv(client, message, sizeof(message) - 1, 0);
  if (length <= 0) {
    pet_control_reply(client, "{\"ok\":false,\"error\":\"empty request\"}");
    return -1;
  }
  message[length] = '\0';
  char error[160];
  if (!pet_control_parse(message, command, error, sizeof(error))) {
    char response[256];
    snprintf(response, sizeof(response), "{\"ok\":false,\"error\":\"%s\"}", error);
    pet_control_reply(client, response);
    return -1;
  }
  return client;
}
