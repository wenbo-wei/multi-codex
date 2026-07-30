#!/bin/sh
set -eu

project_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
extension_uuid='multi-codex@wenbo'
settings_helper="$project_root/scripts/extension-settings.mjs"

fail() {
    echo "error: $*" >&2
    exit 1
}

[ -n "${HOME:-}" ] || fail 'HOME is not set'
case "$HOME" in
    /*) ;;
    *) fail 'HOME must be an absolute path' ;;
esac

data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
case "$data_home" in
    /*) ;;
    *) fail 'XDG_DATA_HOME must be an absolute path' ;;
esac

command -v gjs >/dev/null 2>&1 ||
    fail 'required command is unavailable: gjs'
[ -f "$settings_helper" ] ||
    fail 'release source is incomplete: scripts/extension-settings.mjs'

extension_dir="$data_home/gnome-shell/extensions/$extension_uuid"
if [ -L "$extension_dir" ]; then
    fail "extension target must not be a symbolic link: $extension_dir"
fi
if [ -e "$extension_dir" ] && [ ! -d "$extension_dir" ]; then
    fail "extension target is not a directory: $extension_dir"
fi

gjs_bin=$(command -v gjs)
"$gjs_bin" -m "$settings_helper" uninstall ||
    fail 'could not remove Multi Codex from GNOME Shell settings'

rm -f -- \
    "$extension_dir/extension.js" \
    "$extension_dir/metadata.json" \
    "$extension_dir/stylesheet.css" \
    "$extension_dir/workspaceLayout.mjs" \
    "$extension_dir/workspaceLayoutCli.mjs" \
    "$extension_dir/workspaceWindowPlacement.mjs" \
    "$extension_dir/workspaceWindowSet.mjs"
scripts_dir="$extension_dir/scripts"
if [ -L "$scripts_dir" ] ||
    { [ -e "$scripts_dir" ] && [ ! -d "$scripts_dir" ]; }; then
    echo "warning: preserved unrecognized path at $scripts_dir" >&2
else
    rm -f -- \
        "$scripts_dir/multi-codex" \
        "$scripts_dir/open-six-terminals"
    rmdir -- "$scripts_dir" 2>/dev/null || true
fi
rmdir -- "$extension_dir" 2>/dev/null || true

if [ -d "$extension_dir" ]; then
    echo "warning: preserved unrecognized files in $extension_dir" >&2
fi
echo 'Multi Codex removed. Ptyxis windows and legacy Workspace files were preserved.'
