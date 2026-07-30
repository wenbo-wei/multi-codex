#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'Usage: package.sh OUTPUT_DIRECTORY\n' >&2
  exit 2
fi

output_dir=$1
tool_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
    pwd -P
)
repository_root=$tool_dir/..

source_date_epoch=${SOURCE_DATE_EPOCH:-}
if [ -z "$source_date_epoch" ]; then
  source_date_epoch=$(
    git -C "$repository_root" log -1 --format=%ct 2>/dev/null ||
      printf '315532800\n'
  )
fi
if ! [[ "$source_date_epoch" =~ ^[0-9]+$ ]] ||
    [ "$source_date_epoch" -lt 315532800 ]; then
  printf 'SOURCE_DATE_EPOCH must be an integer at or after 1980-01-01.\n' >&2
  exit 2
fi

staging_root=$(mktemp -d /tmp/multi-codex-pack.XXXXXX)
cleanup() {
  rm -rf -- "$staging_root"
}
trap cleanup EXIT HUP INT TERM

staged_extension=$staging_root/extension
mkdir -p "$staged_extension" "$output_dir"
cp -a "$repository_root/extension/." "$staged_extension/"
find "$staged_extension" -exec \
  touch -h --date="@$source_date_epoch" {} +

TZ=UTC LC_ALL=C gnome-extensions pack \
  --force \
  --out-dir="$output_dir" \
  --extra-source=runtimeCommand.mjs \
  --extra-source=workspaceLayout.mjs \
  --extra-source=workspaceLayoutCli.mjs \
  --extra-source=workspaceWindowPlacement.mjs \
  --extra-source=workspaceWindowSet.mjs \
  --extra-source=scripts \
  "$staged_extension"
