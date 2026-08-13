#include "../characters/character.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int assertions;

#define CHECK(condition) do { \
  assertions++; \
  if (!(condition)) { \
    fprintf(stderr, "%s:%d: check failed: %s\n", __FILE__, __LINE__, #condition); \
    exit(EXIT_FAILURE); \
  } \
} while (0)

static const PetHitbox hitboxes[] = { { 0, 0, 1, 1 } };
static const PetAnimationSource source = { "source", "test.png", 1, 1, 1, hitboxes };
static const int order[] = { 0 };

static const PetAnimationDefinition default_animations[] = {
  { "idle", &source, order, 1, 1, true, false, false, NULL },
  { "walk-left", &source, order, 1, 1, true, false, false, NULL },
  { "clicked", &source, order, 1, 1, false, false, false, "idle" },
};
static const PetStateFallback default_fallbacks[] = {
  { "run-left", "walk-left" },
};
static const PetAnimationDefinition skin_animations[] = {
  { "idle", &source, order, 1, 1, true, false, false, NULL },
};
static const PetStateFallback skin_fallbacks[] = {
  { "special", "idle" },
};
static const PetStateFallback cyclic_fallbacks[] = {
  { "one", "two" },
  { "two", "one" },
};
static const PetVariant variants[] = {
  {
    "default", NULL, "Default", "默认", "base_form", "test/default", 1.0f, true,
    default_animations, sizeof(default_animations) / sizeof(default_animations[0]),
    default_fallbacks, sizeof(default_fallbacks) / sizeof(default_fallbacks[0]), NULL
  },
  {
    "winter", "skin-winter", "Winter", "冬季", "skin", "test/winter", 1.0f, true,
    skin_animations, sizeof(skin_animations) / sizeof(skin_animations[0]),
    skin_fallbacks, sizeof(skin_fallbacks) / sizeof(skin_fallbacks[0]), "default"
  },
  {
    "isolated", "skin-isolated", "Isolated", "隔离", "skin", "test/isolated", 1.0f, true,
    skin_animations, sizeof(skin_animations) / sizeof(skin_animations[0]),
    cyclic_fallbacks, sizeof(cyclic_fallbacks) / sizeof(cyclic_fallbacks[0]), NULL
  },
};

const PetCharacter PET_CHARACTERS[] = {
  {
    "test", "Test", "测试", 50.0f, 80.0f, 1.0f, 2.0f, 30.0f,
    variants, sizeof(variants) / sizeof(variants[0]), "default"
  },
};
const size_t PET_CHARACTER_COUNT = sizeof(PET_CHARACTERS) / sizeof(PET_CHARACTERS[0]);

static void test_variant_lookup(void) {
  const PetCharacter *character = pet_character_find("test");
  CHECK(character == &PET_CHARACTERS[0]);
  CHECK(pet_character_find(NULL) == NULL);
  CHECK(pet_character_find("missing") == NULL);
  CHECK(pet_character_default_variant(character) == &variants[0]);
  CHECK(pet_character_variant(character, "winter") == &variants[1]);
  CHECK(pet_character_variant(character, "skin-winter") == &variants[1]);
  CHECK(pet_character_variant(character, "missing") == NULL);
}

static void test_variant_animation_resolution(void) {
  const PetCharacter *character = &PET_CHARACTERS[0];
  PetAnimationResolution resolution;

  CHECK(pet_character_resolve_animation(character, &variants[1], "idle", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_EXACT);
  CHECK(resolution.variant == &variants[1]);
  CHECK(strcmp(resolution.resolved_state, "idle") == 0);

  CHECK(pet_character_resolve_animation(character, &variants[1], "special", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_STATE_FALLBACK);
  CHECK(resolution.variant == &variants[1]);
  CHECK(strcmp(resolution.resolved_state, "idle") == 0);

  CHECK(pet_character_resolve_animation(character, &variants[1], "clicked", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_DEFAULT_VARIANT);
  CHECK(resolution.variant == &variants[0]);
  CHECK(strcmp(resolution.resolved_state, "clicked") == 0);

  CHECK(pet_character_resolve_animation(character, &variants[1], "run-left", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_DEFAULT_VARIANT_STATE_FALLBACK);
  CHECK(resolution.variant == &variants[0]);
  CHECK(strcmp(resolution.resolved_state, "walk-left") == 0);

  CHECK(!pet_character_resolve_animation(character, &variants[1], "unknown", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_UNRESOLVED);
  CHECK(!pet_character_resolve_animation(character, &variants[2], "clicked", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_UNRESOLVED);
  CHECK(!pet_character_resolve_animation(character, &variants[2], "one", &resolution));
  CHECK(resolution.kind == PET_ANIMATION_UNRESOLVED);
}

int main(void) {
  test_variant_lookup();
  test_variant_animation_resolution();
  printf("OK: %d registry assertions (characters, skins, explicit fallback)\n", assertions);
  return EXIT_SUCCESS;
}
