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
mkdir -p "$output_dir"
output_dir=$(
  CDPATH= cd -- "$output_dir" &&
    pwd -P
)

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
validation_dir=$staging_root/validated
canonical_dir=$staging_root/canonical
mkdir -p "$staged_extension" "$validation_dir" "$canonical_dir"
cp -a "$repository_root/extension/." "$staged_extension/"
cp -a "$repository_root/LICENSE" "$staged_extension/LICENSE"
find "$staged_extension" -type d -exec chmod 0755 {} +
find "$staged_extension" -type f -exec chmod 0644 {} +
chmod 0755 \
  "$staged_extension/scripts/multi-codex" \
  "$staged_extension/scripts/open-six-terminals"
find "$staged_extension" -exec \
  touch -h --date="@$source_date_epoch" {} +

TZ=UTC LC_ALL=C gnome-extensions pack \
  --force \
  --out-dir="$validation_dir" \
  --extra-source=workspaceLayout.mjs \
  --extra-source=workspaceLayoutCli.mjs \
  --extra-source=workspaceWindowPlacement.mjs \
  --extra-source=workspaceWindowSet.mjs \
  --extra-source=LICENSE \
  --extra-source=scripts \
  "$staged_extension"

shopt -s nullglob
validated_packages=("$validation_dir"/*.shell-extension.zip)
if [ "${#validated_packages[@]}" -ne 1 ]; then
  printf 'Expected exactly one validated extension package.\n' >&2
  exit 1
fi

unzip -q "${validated_packages[0]}" -d "$canonical_dir"
find "$canonical_dir" -type d -exec chmod 0755 {} +
find "$canonical_dir" -type f -exec chmod 0644 {} +
chmod 0755 \
  "$canonical_dir/scripts/multi-codex" \
  "$canonical_dir/scripts/open-six-terminals"
find "$canonical_dir" -exec \
  touch -h --date="@$source_date_epoch" {} +
file_list=$staging_root/package-files
(
  CDPATH= cd -- "$canonical_dir"
  find . -type f -printf '%P\n' | LC_ALL=C sort > "$file_list"
)

package=$output_dir/$(basename -- "${validated_packages[0]}")
rm -f -- "$package"
(
  CDPATH= cd -- "$canonical_dir"
  TZ=UTC LC_ALL=C zip -X -q "$package" -@ < "$file_list"
)
