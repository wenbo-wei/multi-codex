#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'Usage: run-production-smoke.sh PACKAGE\n' >&2
  exit 2
fi

package=$1
if [ ! -f "$package" ]; then
  printf 'Package not found: %s\n' "$package" >&2
  exit 1
fi

metadata_values=$(
  unzip -p "$package" metadata.json |
    python3 -c \
      'import json,sys; data=json.load(sys.stdin); print(data["uuid"], data["version"], sep="\t")'
)
IFS=$'\t' read -r uuid version <<< "$metadata_values"
if ! [[ "$uuid" =~ ^[A-Za-z0-9._@-]+$ ]] ||
    ! [[ "$version" =~ ^[0-9]+$ ]]; then
  printf 'Package metadata has an invalid UUID or version.\n' >&2
  exit 1
fi

runtime_dir=$(mktemp -d /tmp/multi-codex-smoke-runtime.XXXXXX)
data_dir=$(mktemp -d /tmp/multi-codex-smoke-data.XXXXXX)
config_dir=$(mktemp -d /tmp/multi-codex-smoke-config.XXXXXX)
cache_dir=$(mktemp -d /tmp/multi-codex-smoke-cache.XXXXXX)
log_file=$(mktemp /tmp/multi-codex-smoke-log.XXXXXX)
chmod 700 "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"

cleanup() {
  rm -rf -- "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"
  rm -f -- "$log_file"
}
trap cleanup EXIT HUP INT TERM

extension_dir=$data_dir/gnome-shell/extensions/$uuid
mkdir -p "$extension_dir"
unzip -q "$package" -d "$extension_dir"

timeout \
  --signal=TERM \
  --kill-after=3s \
  12s \
  env \
    XDG_RUNTIME_DIR="$runtime_dir" \
    XDG_DATA_HOME="$data_dir" \
    XDG_CONFIG_HOME="$config_dir" \
    XDG_CACHE_HOME="$cache_dir" \
    GIO_USE_VFS=local \
    MULTI_CODEX_SMOKE_UUID="$uuid" \
  dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions \
      "[\"$MULTI_CODEX_SMOKE_UUID\"]"
    gnome-shell \
      --headless \
      --virtual-monitor=1280x720 \
      --wayland-display=workspace-production-smoke &
    shell_pid=$!
    sleep 3
    gnome-extensions info "$MULTI_CODEX_SMOKE_UUID"
    info_status=$?
    kill -TERM "$shell_pid"
    wait "$shell_pid" 2>/dev/null || true
    exit "$info_status"
  ' >"$log_file" 2>&1

info=$(
  sed -n \
    "/^${uuid}$/,/^  State:/p" \
    "$log_file"
)
printf '%s\n' "$info"
if [[ "$info" != *"Version: $version"* ]] ||
    [[ "$info" != *'State: ACTIVE'* ]]; then
  exit 1
fi
if rg -q \
    "Extension ${uuid}.*(ImportError|JS ERROR|CRITICAL)" \
    "$log_file"; then
  rg -n \
    "Extension ${uuid}.*(ImportError|JS ERROR|CRITICAL)" \
    "$log_file" >&2
  exit 1
fi
