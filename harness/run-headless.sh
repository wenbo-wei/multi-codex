#!/usr/bin/env bash

set -euo pipefail

case "${1:-}" in
  v6|v7|fix)
    mode=$1
    ;;
  *)
    printf 'Usage: %s {v6|v7|fix}\n' "$0" >&2
    exit 2
    ;;
esac

task_root=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." &&
    pwd -P
)
runtime_dir=$(mktemp -d /tmp/multi-codex-placement-runtime.XXXXXX)
data_dir=$(mktemp -d /tmp/multi-codex-placement-data.XXXXXX)
config_dir=$(mktemp -d /tmp/multi-codex-placement-config.XXXXXX)
cache_dir=$(mktemp -d /tmp/multi-codex-placement-cache.XXXXXX)
log_file=$(mktemp /tmp/multi-codex-placement-log.XXXXXX)
chmod 700 "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"
extension_dir=$data_dir/gnome-shell/extensions/multi-codex-placement-harness@wenbo
mkdir -p "$extension_dir"
ln -s \
  "$task_root/harness/extension.js" \
  "$extension_dir/extension.js"
ln -s \
  "$task_root/harness/metadata.json" \
  "$extension_dir/metadata.json"
ln -s \
  "$task_root/extension/workspaceLayout.mjs" \
  "$extension_dir/workspaceLayout.mjs"
ln -s \
  "$task_root/extension/workspaceWindowPlacement.mjs" \
  "$extension_dir/workspaceWindowPlacement.mjs"

cleanup() {
  local pid_output
  if pid_output=$(
      pgrep -f \
        '^/usr/bin/ptyxis --standalone --title=Harness Terminal [1-6]$' \
        2>/dev/null
  ); then
    while read -r pid; do
      if [[ "$pid" =~ ^[0-9]+$ ]]; then
        kill -TERM "$pid" 2>/dev/null || true
      fi
    done <<< "$pid_output"
  fi
  rm -rf -- "$runtime_dir" "$data_dir" "$config_dir" "$cache_dir"
  rm -f -- "$log_file"
}
trap cleanup EXIT HUP INT TERM

set +e
timeout \
  --signal=TERM \
  --kill-after=3s \
  11s \
  env \
    XDG_RUNTIME_DIR="$runtime_dir" \
    XDG_DATA_HOME="$data_dir" \
    XDG_CONFIG_HOME="$config_dir" \
    XDG_CACHE_HOME="$cache_dir" \
    GIO_USE_VFS=local \
    MULTI_CODEX_HARNESS_MODE="$mode" \
  dbus-run-session -- bash -c '
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions \
      "[\"multi-codex-placement-harness@wenbo\"]"
    exec gnome-shell \
      --headless \
      --virtual-monitor=1280x720 \
      --wayland-display=workspace-placement-test
  ' >"$log_file" 2>&1
shell_status=$?
set -e

rg --fixed-strings '[MULTI-CODEX-HARNESS]' "$log_file" || true
result=$(rg --fixed-strings '[MULTI-CODEX-HARNESS] RESULT' "$log_file" || true)
if [ -z "$result" ]; then
  printf 'Harness produced no result (shell status %s).\n' \
    "$shell_status" >&2
  tail -n 80 "$log_file" >&2
  exit 1
fi
if [[ "$result" != *'reason=complete'* ]] ||
    [[ "$result" != *'windows=6'* ]] ||
    [[ "$result" != *'identity_misses=0'* ]] ||
    [[ "$result" != *'actor_misses=0'* ]]; then
  exit 1
fi
if [ "$mode" = fix ] &&
    [[ "$result" != *'visible_before_target=none'* ]]; then
  exit 1
fi
