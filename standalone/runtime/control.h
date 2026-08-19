#ifndef PET_ARK_CONTROL_H
#define PET_ARK_CONTROL_H

#include <stdbool.h>
#include <stddef.h>

#define PET_CONTROL_ID_MAX 96
#define PET_CONTROL_MESSAGE_MAX 2048

typedef enum {
  PET_CONTROL_INVALID,
  PET_CONTROL_GET_STATUS,
  PET_CONTROL_SET_SCALE,
  PET_CONTROL_SET_SPEED,
  PET_CONTROL_SET_AUTO_MOVE,
  PET_CONTROL_SET_CLICK_THROUGH,
  PET_CONTROL_SELECT,
  PET_CONTROL_REACT,
  PET_CONTROL_ACT,
  PET_CONTROL_QUIT,
} PetControlCommandKind;

typedef struct {
  PetControlCommandKind kind;
  float number;
  bool boolean;
  char character[PET_CONTROL_ID_MAX];
  char variant[PET_CONTROL_ID_MAX];
  char event[PET_CONTROL_ID_MAX];
  char action[PET_CONTROL_ID_MAX];
  float x;
  int direction;
} PetControlCommand;

typedef struct {
  int fd;
  char path[108];
} PetControlServer;

bool pet_control_parse(const char *json, PetControlCommand *command,
                       char *error, size_t error_size);

bool pet_control_server_open(PetControlServer *server, const char *requested_path,
                             const char *instance_id,
                             char *error, size_t error_size);
void pet_control_server_close(PetControlServer *server);

/* Accepts and parses one pending local request. Returns its client fd or -1. */
int pet_control_server_receive(PetControlServer *server, PetControlCommand *command);
void pet_control_reply(int client_fd, const char *json);

#endif
