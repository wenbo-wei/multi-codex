#!/usr/bin/env bash

set -euo pipefail

task_root=/home/wenbo/codex/workspace-placement-review
runtime_dir=$(mktemp -d /tmp/workspace-smoke-runtime.XXXXXX)
data_dir=$(mktemp -d /tmp/workspace-smoke-data.XXXXXX)
config_dir=$(mktemp -d /tmp/workspace-smoke-config.XXXXXX)
cache_dir=$(mktemp -d /tmp/workspace-smoke-cache.XXXXXX)
log_file=$(mktemp /tmp/workspace-smoke-log.XXXXXX)
chmod 700 "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"
mkdir -p "$data_dir/gnome-shell/extensions"
ln -s \
  "$task_root/extensions/workspace@wenbo" \
  "$data_dir/gnome-shell/extensions/workspace@wenbo"

cleanup() {
  rm -rf -- "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"
  rm -f -- "$log_file"
}
trap cleanup EXIT HUP INT TERM

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
  dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions \
      "[\"workspace@wenbo\"]"
    gnome-shell \
      --headless \
      --virtual-monitor=1280x720 \
      --wayland-display=workspace-production-smoke &
    shell_pid=$!
    sleep 3
    gnome-extensions info workspace@wenbo
    info_status=$?
    kill -TERM "$shell_pid"
    wait "$shell_pid" 2>/dev/null || true
    exit "$info_status"
  ' >"$log_file" 2>&1

info=$(
  sed -n \
    '/^workspace@wenbo$/,/^  State:/p' \
    "$log_file"
)
printf '%s\n' "$info"
if [[ "$info" != *'Version: 9'* ]] ||
    [[ "$info" != *'State: ACTIVE'* ]]; then
  exit 1
fi
if rg -q \
    'Extension workspace@wenbo.*(ImportError|JS ERROR|CRITICAL)' \
    "$log_file"; then
  rg -n \
    'Extension workspace@wenbo.*(ImportError|JS ERROR|CRITICAL)' \
    "$log_file" >&2
  exit 1
fi
