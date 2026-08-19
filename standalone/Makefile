CC ?= cc
PKG_CONFIG ?= pkg-config
NODE ?= node
SYSROOT ?=
BUILD_DIR ?= build
APP_NAME ?= pet-ark
PKGS ?= wayland-client wayland-cursor libpng
MULTIARCH ?= $(shell $(CC) -dumpmachine)

BASE_CPPFLAGS := -I. -Iruntime -Iruntime/protocol -Ianimations -Icharacters
BASE_CFLAGS := -std=c11 -O2 -g -Wall -Wextra -Wpedantic -MMD -MP
SYSROOT_FLAG := $(if $(strip $(SYSROOT)),--sysroot=$(SYSROOT),)
SYSROOT_PKG_CONFIG_LIBDIR := $(SYSROOT)/usr/lib/$(MULTIARCH)/pkgconfig:$(SYSROOT)/usr/lib/pkgconfig:$(SYSROOT)/usr/share/pkgconfig
PKG_CONFIG_RUN = PKG_CONFIG_SYSROOT_DIR="$(SYSROOT)" $(if $(strip $(SYSROOT)),PKG_CONFIG_LIBDIR="$(SYSROOT_PKG_CONFIG_LIBDIR)") $(PKG_CONFIG)
PKG_CFLAGS = $(shell $(PKG_CONFIG_RUN) --cflags $(PKGS) 2>/dev/null)
PKG_LIBS = $(shell $(PKG_CONFIG_RUN) --libs $(PKGS) 2>/dev/null)

APP_SOURCES := \
  $(sort $(wildcard app/*.c)) \
  $(sort $(wildcard runtime/*.c)) \
  $(sort $(wildcard animations/*.c)) \
  $(sort $(wildcard characters/*.c)) \
  $(sort $(wildcard runtime/protocol/*-protocol.c))
APP_OBJECTS := $(patsubst %.c,$(BUILD_DIR)/objects/%.o,$(APP_SOURCES))
APP_BINARY := $(BUILD_DIR)/$(APP_NAME)

TEST_SOURCES := \
  tests/test_runtime.c \
  runtime/control.c \
  runtime/state_machine.c \
  runtime/runtime_policy.c \
  runtime/movement.c \
  animations/animation.c
TEST_OBJECTS := $(patsubst %.c,$(BUILD_DIR)/test-objects/%.o,$(TEST_SOURCES))
TEST_BINARY := $(BUILD_DIR)/tests/runtime-tests
REGISTRY_TEST_SOURCES := \
  tests/test_registry.c \
  characters/character.c
REGISTRY_TEST_OBJECTS := $(patsubst %.c,$(BUILD_DIR)/registry-test-objects/%.o,$(REGISTRY_TEST_SOURCES))
REGISTRY_TEST_BINARY := $(BUILD_DIR)/tests/registry-tests

.PHONY: all build test check-deps generate-registry clean help

all: build

help:
	@echo "Targets: build, test, check-deps, generate-registry, clean"
	@echo "Overrides: CC=... PKG_CONFIG=... SYSROOT=... BUILD_DIR=..."

check-deps:
	@command -v "$(CC)" >/dev/null 2>&1 || { \
	  echo "error: C compiler '$(CC)' was not found." >&2; \
	  echo "Install a C toolchain (for Debian/Ubuntu: sudo apt install build-essential)." >&2; \
	  exit 2; \
	}
	@command -v "$(PKG_CONFIG)" >/dev/null 2>&1 || { \
	  echo "error: pkg-config command '$(PKG_CONFIG)' was not found." >&2; \
	  echo "Install pkg-config before building the standalone desktop app." >&2; \
	  exit 2; \
	}
	@$(PKG_CONFIG_RUN) --exists $(PKGS) || { \
	  echo "error: missing standalone native development packages: $(PKGS)" >&2; \
	  echo "Debian/Ubuntu: sudo apt install build-essential pkg-config libwayland-dev libpng-dev" >&2; \
	  echo "Fedora: sudo dnf install gcc make pkgconf-pkg-config wayland-devel libpng-devel" >&2; \
	  echo "For cross builds, pass SYSROOT=/path and a matching PKG_CONFIG= command." >&2; \
	  exit 2; \
	}
	@test -n "$(strip $(wildcard app/*.c))" || { \
	  echo "error: standalone/app has no C entry point (expected app/main.c)." >&2; \
	  exit 2; \
	}

generate-registry:
	@command -v "$(NODE)" >/dev/null 2>&1 || { \
	  echo "error: Node.js is required to generate the standalone C character registry." >&2; \
	  exit 2; \
	}
	$(NODE) ../shared/image-processing/build-runtime-registry.mjs
	$(NODE) ../shared/asset-tools/generate-standalone-registry.mjs

build: check-deps generate-registry
	@$(MAKE) --no-print-directory "$(APP_BINARY)"

$(APP_BINARY): $(APP_OBJECTS)
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(LDFLAGS) $^ $(PKG_LIBS) -lm -lrt $(LDLIBS) -o "$@"

$(BUILD_DIR)/objects/%.o: %.c
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(CPPFLAGS) $(BASE_CPPFLAGS) $(PKG_CFLAGS) $(CFLAGS) $(BASE_CFLAGS) -c "$<" -o "$@"

test: $(TEST_BINARY) $(REGISTRY_TEST_BINARY)
	$(NODE) ../shared/image-processing/test-triangle-rasterizer.mjs
	$(NODE) ../shared/image-processing/test-runtime-registry.mjs
	$(NODE) ../shared/asset-tools/test-standalone-registry-sources.mjs
	$(NODE) ../shared/image-processing/test-standalone-animation-contract.mjs
	$(NODE) ../shared/image-processing/test-spine-placement-regressions.mjs
	"$(TEST_BINARY)"
	"$(REGISTRY_TEST_BINARY)"

$(TEST_BINARY): $(TEST_OBJECTS)
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(LDFLAGS) $^ -lm $(LDLIBS) -o "$@"

$(BUILD_DIR)/test-objects/%.o: %.c
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(CPPFLAGS) $(BASE_CPPFLAGS) $(CFLAGS) $(BASE_CFLAGS) -c "$<" -o "$@"

$(REGISTRY_TEST_BINARY): $(REGISTRY_TEST_OBJECTS)
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(LDFLAGS) $^ $(LDLIBS) -o "$@"

$(BUILD_DIR)/registry-test-objects/%.o: %.c
	@mkdir -p "$(@D)"
	$(CC) $(SYSROOT_FLAG) $(CPPFLAGS) $(BASE_CPPFLAGS) $(CFLAGS) $(BASE_CFLAGS) -c "$<" -o "$@"

clean:
	rm -rf "$(BUILD_DIR)"

-include $(APP_OBJECTS:.o=.d)
-include $(TEST_OBJECTS:.o=.d)
-include $(REGISTRY_TEST_OBJECTS:.o=.d)
