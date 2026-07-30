#!/bin/sh
set -eu

project_root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
extension_uuid='multi-codex@wenbo'
legacy_extension_uuid='workspace@wenbo'
settings_helper="$project_root/scripts/extension-settings.mjs"

fail() {
    echo "error: $*" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 ||
        fail "required command is unavailable: $1"
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

for required_command in \
    bash \
    gjs \
    gnome-extensions \
    gnome-shell \
    grep \
    pgrep \
    ptyxis \
    sed \
    sleep \
    systemctl \
    systemd-run \
    timeout \
    xdotool \
    xprop \
    Xwayland
do
    require_command "$required_command"
done

shell_version_output=$(gnome-shell --version 2>/dev/null) ||
    fail 'could not determine the GNOME Shell version'
shell_version=${shell_version_output##* }
shell_major=${shell_version%%.*}
[ "$shell_major" = 50 ] ||
    fail "GNOME Shell 50 is required; found: $shell_version_output"

systemctl --user show-environment >/dev/null 2>&1 ||
    fail 'the systemd user manager is unavailable'

source_extension="$project_root/extension"
for source_file in \
    extension.js \
    metadata.json \
    stylesheet.css \
    workspaceLayout.mjs \
    workspaceLayoutCli.mjs \
    workspaceWindowPlacement.mjs \
    workspaceWindowSet.mjs
do
    [ -f "$source_extension/$source_file" ] ||
        fail "release source is incomplete: extension/$source_file"
done
for source_script in multi-codex open-six-terminals; do
    [ -f "$source_extension/scripts/$source_script" ] ||
        fail "release source is incomplete: extension/scripts/$source_script"
done
[ -f "$settings_helper" ] ||
    fail 'release source is incomplete: scripts/extension-settings.mjs'

extension_root="$data_home/gnome-shell/extensions"
extension_dir="$extension_root/$extension_uuid"
install -d -m 0755 "$extension_root"

if [ -L "$extension_dir" ]; then
    fail "extension target must not be a symbolic link: $extension_dir"
fi
if [ -e "$extension_dir" ] && [ ! -d "$extension_dir" ]; then
    fail "extension target is not a directory: $extension_dir"
fi

stage_dir=$(mktemp -d "$extension_root/.${extension_uuid}.stage.XXXXXX")
backup_root=
replacement_installed=false
transaction_complete=false
settings_snapshot=
gjs_bin=$(command -v gjs)

cleanup() {
    if [ "$transaction_complete" != true ] &&
        [ -n "$settings_snapshot" ]; then
        "$gjs_bin" -m "$settings_helper" restore "$settings_snapshot" \
            >/dev/null 2>&1 ||
            echo 'warning: could not fully roll back extension settings' >&2
    fi
    if [ "$transaction_complete" != true ] &&
        [ "$replacement_installed" = true ]; then
        rm -rf -- "$extension_dir"
    fi
    if [ "$transaction_complete" != true ] &&
        [ -n "$backup_root" ] &&
        [ -d "$backup_root/previous" ] &&
        [ ! -e "$extension_dir" ]; then
        mv -- "$backup_root/previous" "$extension_dir"
    fi
    if [ -n "$stage_dir" ] && [ -d "$stage_dir" ]; then
        rm -rf -- "$stage_dir"
    fi
    if [ -n "$backup_root" ] && [ -d "$backup_root" ]; then
        rm -rf -- "$backup_root"
    fi
    if [ -n "$settings_snapshot" ]; then
        rm -f -- "$settings_snapshot"
    fi
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

if [ -d "$extension_dir" ]; then
    cp -a -- "$extension_dir/." "$stage_dir/"
fi
for owned_file in \
    extension.js \
    metadata.json \
    stylesheet.css \
    workspaceLayout.mjs \
    workspaceLayoutCli.mjs \
    workspaceWindowPlacement.mjs \
    workspaceWindowSet.mjs
do
    rm -f -- "$stage_dir/$owned_file"
done
if [ -L "$stage_dir/scripts" ] ||
    { [ -e "$stage_dir/scripts" ] && [ ! -d "$stage_dir/scripts" ]; }; then
    fail 'existing extension scripts path is not a directory; preserved it'
fi
install -d -m 0755 "$stage_dir/scripts"
rm -f -- \
    "$stage_dir/scripts/multi-codex" \
    "$stage_dir/scripts/open-six-terminals"
install -m 0644 \
    "$source_extension/extension.js" \
    "$source_extension/metadata.json" \
    "$source_extension/stylesheet.css" \
    "$source_extension/workspaceLayout.mjs" \
    "$source_extension/workspaceLayoutCli.mjs" \
    "$source_extension/workspaceWindowPlacement.mjs" \
    "$source_extension/workspaceWindowSet.mjs" \
    "$stage_dir/"
install -m 0755 \
    "$source_extension/scripts/multi-codex" \
    "$source_extension/scripts/open-six-terminals" \
    "$stage_dir/scripts/"

if [ -d "$extension_dir" ]; then
    backup_root=$(mktemp -d "$extension_root/.${extension_uuid}.backup.XXXXXX")
    mv -- "$extension_dir" "$backup_root/previous"
fi
replacement_installed=true
if ! mv -- "$stage_dir" "$extension_dir"; then
    fail 'could not activate the staged extension directory'
fi
stage_dir=

settings_snapshot=$(
    mktemp "$extension_root/.${extension_uuid}.settings.XXXXXX"
)
"$gjs_bin" -m "$settings_helper" snapshot "$settings_snapshot" ||
    fail 'could not snapshot GNOME Shell extension settings'

legacy_enabled=false
if "$gjs_bin" -m "$settings_helper" legacy-enabled >/dev/null 2>&1; then
    legacy_enabled=true
else
    settings_status=$?
    [ "$settings_status" -eq 3 ] ||
        fail 'could not read GNOME Shell extension settings'
fi

new_extension_discovered=false
if gnome-extensions info "$extension_uuid" >/dev/null 2>&1; then
    new_extension_discovered=true
fi

wait_for_new_extension() {
    attempt=0
    while [ "$attempt" -lt 50 ]; do
        if ! active_extensions=$(
            gnome-extensions list --active 2>/dev/null
        ); then
            return 2
        fi
        if printf '%s\n' "$active_extensions" |
            grep -Fxq "$extension_uuid"; then
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 0.1
    done
    return 1
}

if [ "$legacy_enabled" != true ]; then
    "$gjs_bin" -m "$settings_helper" queue-clean ||
        fail 'could not queue Multi Codex in GNOME Shell settings'
    if [ "$new_extension_discovered" = true ]; then
        if wait_for_new_extension; then
            :
        else
            activation_status=$?
            if [ "$activation_status" -eq 2 ]; then
                fail 'could not verify that Multi Codex became active'
            fi
            fail 'Multi Codex did not become active; previous state was restored'
        fi
    fi
    transaction_complete=true
    echo "Multi Codex installed as $extension_uuid."
    echo 'It is enabled now when discoverable, or automatically at next sign-in.'
    exit 0
fi

if [ "$new_extension_discovered" != true ]; then
    transaction_complete=true
    echo "Multi Codex files were staged as $extension_uuid."
    echo "The working legacy $legacy_extension_uuid extension remains enabled."
    echo 'Sign out, sign back in, and rerun this installer to finish migration.'
    exit 2
fi

"$gjs_bin" -m "$settings_helper" prepare-migration ||
    fail 'could not prepare the legacy Workspace migration'

if wait_for_new_extension; then
    :
else
    activation_status=$?
    if [ "$activation_status" -eq 2 ]; then
        fail 'could not verify that Multi Codex became active'
    fi
    fail 'Multi Codex did not become active; legacy Workspace was preserved'
fi

if ! "$gjs_bin" -m "$settings_helper" retire-legacy; then
    fail 'Multi Codex is active, but legacy Workspace could not be retired'
fi

transaction_complete=true
echo "Multi Codex installed and active as $extension_uuid."
echo "Legacy $legacy_extension_uuid files were preserved and its setting retired."
