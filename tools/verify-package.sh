#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'Usage: verify-package.sh PACKAGE\n' >&2
  exit 2
fi

package=$1
tool_dir=$(
  CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &&
    pwd -P
)
repository_root=$tool_dir/..
if [ ! -f "$package" ]; then
  printf 'Package does not exist: %s\n' "$package" >&2
  exit 1
fi

verification_root=$(mktemp -d /tmp/multi-codex-verify.XXXXXX)
cleanup() {
  rm -rf -- "$verification_root"
}
trap cleanup EXIT HUP INT TERM

expected_files=$verification_root/expected-files
actual_files=$verification_root/actual-files
cat >"$expected_files" <<'EOF'
LICENSE
extension.js
metadata.json
scripts/multi-codex
scripts/open-six-terminals
stylesheet.css
workspaceLayout.mjs
workspaceLayoutCli.mjs
workspaceWindowPlacement.mjs
workspaceWindowSet.mjs
EOF

unzip -tq "$package" >/dev/null
unzip -Z1 "$package" | LC_ALL=C sort >"$actual_files"
if ! diff -u "$expected_files" "$actual_files"; then
  printf 'Package file inventory is not canonical.\n' >&2
  exit 1
fi

extracted=$verification_root/extracted
mkdir -p "$extracted"
unzip -q "$package" -d "$extracted"

while IFS= read -r relative_path; do
  source_path=$repository_root/extension/$relative_path
  if [ "$relative_path" = LICENSE ]; then
    source_path=$repository_root/LICENSE
  fi
  if ! cmp -s \
      "$source_path" \
      "$extracted/$relative_path"; then
    printf 'Packaged bytes differ: %s\n' "$relative_path" >&2
    exit 1
  fi
done <"$expected_files"

python3 - "$package" "$extracted/metadata.json" <<'PY'
import json
from pathlib import Path
import sys
import zipfile

package = Path(sys.argv[1])
metadata = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
if metadata.get("uuid") != "multi-codex@wenbo":
    raise SystemExit("unexpected extension UUID")
if metadata.get("shell-version") != ["50"]:
    raise SystemExit("unexpected GNOME Shell support declaration")
version = metadata.get("version")
if not isinstance(version, int) or version < 2:
    raise SystemExit("extension version was not incremented")

expected_modes = {
    "LICENSE": 0o644,
    "extension.js": 0o644,
    "metadata.json": 0o644,
    "scripts/multi-codex": 0o755,
    "scripts/open-six-terminals": 0o755,
    "stylesheet.css": 0o644,
    "workspaceLayout.mjs": 0o644,
    "workspaceLayoutCli.mjs": 0o644,
    "workspaceWindowPlacement.mjs": 0o644,
    "workspaceWindowSet.mjs": 0o644,
}
with zipfile.ZipFile(package) as archive:
    archived_modes = {
        info.filename: (info.external_attr >> 16) & 0o777
        for info in archive.infolist()
    }
if archived_modes != expected_modes:
    details = ", ".join(
        f"{path}={mode:#05o}"
        for path, mode in sorted(archived_modes.items())
    )
    raise SystemExit(f"unexpected package modes: {details}")
PY

printf 'Verified %s\n' "$package"
