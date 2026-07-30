#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'Usage: check-package.sh PACKAGE\n' >&2
  exit 2
fi

package=$1
if [ ! -f "$package" ]; then
  printf 'Package not found: %s\n' "$package" >&2
  exit 1
fi

expected=$(
  printf '%s\n' \
    extension.js \
    metadata.json \
    runtimeCommand.mjs \
    scripts/multi-codex \
    scripts/open-six-terminals \
    stylesheet.css \
    workspaceLayout.mjs \
    workspaceLayoutCli.mjs \
    workspaceWindowPlacement.mjs \
    workspaceWindowSet.mjs |
    LC_ALL=C sort
)
actual=$(
  unzip -Z1 "$package" |
    sed '/\/$/d' |
    LC_ALL=C sort
)

if [ "$actual" != "$expected" ]; then
  printf 'Unexpected package contents.\nExpected:\n%s\nActual:\n%s\n' \
    "$expected" "$actual" >&2
  exit 1
fi

extract_dir=$(mktemp -d /tmp/multi-codex-package.XXXXXX)
cleanup() {
  rm -rf -- "$extract_dir"
}
trap cleanup EXIT HUP INT TERM

unzip -q "$package" -d "$extract_dir"

for script in multi-codex open-six-terminals; do
  if [ ! -x "$extract_dir/scripts/$script" ]; then
    printf 'Packaged runtime is not executable: scripts/%s\n' \
      "$script" >&2
    exit 1
  fi
done

if rg -n -uu \
    '/home/wenbo|workspace@wenbo|codex-quota/' \
    "$extract_dir"; then
  printf 'Package contains a legacy path or unrelated source.\n' >&2
  exit 1
fi

printf 'Verified %s\n' "$package"
