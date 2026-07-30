from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "extension" / "scripts"
HELPER = RUNTIME / "open-six-terminals"
RUNNER = RUNTIME / "multi-codex"


def write_executable(path: Path, contents: str) -> None:
    path.write_text(textwrap.dedent(contents), encoding="utf-8")
    path.chmod(0o755)


class WorkspaceScriptTests(unittest.TestCase):
    def test_missing_reports_only_bare_missing_slots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fakebin = Path(directory)
            write_executable(
                fakebin / "pgrep",
                """\
                #!/usr/bin/env bash
                slot=${!#}
                slot=${slot%$}
                slot=${slot##*Terminal }
                case "$slot" in
                  1|3|6) printf '10%s\n' "$slot" ;;
                  2|4|5) exit 1 ;;
                  *) exit 2 ;;
                esac
                """,
            )
            write_executable(
                fakebin / "xdotool",
                """\
                #!/usr/bin/env bash
                if [ "$1" != search ] || [ "$2" != --pid ]; then
                  exit 2
                fi
                printf '%s2\n' "$3"
                """,
            )
            write_executable(
                fakebin / "xprop",
                """\
                #!/usr/bin/env bash
                if [ "$1" != -id ] ||
                    [ "$3" != _NET_WM_DESKTOP ]; then
                  exit 2
                fi
                printf '_NET_WM_DESKTOP(CARDINAL) = 0\n'
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_BOUNDED": "1",
                }
            )

            result = subprocess.run(
                [str(HELPER), "--missing"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "2\n4\n5\n")
            self.assertEqual(result.stderr, "")

    def test_process_without_managed_window_is_starting_not_error(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fakebin = Path(directory)
            log = fakebin / "calls"
            write_executable(
                fakebin / "pgrep",
                """\
                #!/usr/bin/env bash
                slot=${!#}
                slot=${slot%$}
                slot=${slot##*Terminal }
                if [ "$slot" = 1 ]; then
                  printf '101\n'
                else
                  exit 1
                fi
                """,
            )
            write_executable(
                fakebin / "xdotool",
                """\
                #!/usr/bin/env bash
                printf 'xdotool:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                if [ "$1" = search ] && [ "$2" = --pid ]; then
                  exit 1
                fi
                exit 2
                """,
            )
            write_executable(
                fakebin / "xprop",
                """\
                #!/usr/bin/env bash
                printf 'xprop:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                exit 2
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_BOUNDED": "1",
                    "MULTI_CODEX_TEST_LOG": str(log),
                }
            )

            result = subprocess.run(
                [str(HELPER), "--missing"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 4, result.stderr)
            self.assertEqual(result.stdout, "")
            self.assertEqual(result.stderr, "")
            calls = log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(
                sum(line.startswith("xdotool:search ") for line in calls),
                1,
            )
            self.assertFalse(
                any(
                    line.startswith(("xdotool:windowsize ", "xdotool:windowmove "))
                    for line in calls
                )
            )
            self.assertFalse(any(line.startswith("xprop:") for line in calls))

    def test_duplicate_process_remains_fatal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fakebin = Path(directory)
            log = fakebin / "calls"
            write_executable(
                fakebin / "pgrep",
                """\
                #!/usr/bin/env bash
                slot=${!#}
                slot=${slot%$}
                slot=${slot##*Terminal }
                if [ "$slot" = 2 ]; then
                  printf '102\n202\n'
                else
                  printf '10%s\n' "$slot"
                fi
                """,
            )
            write_executable(
                fakebin / "xdotool",
                """\
                #!/usr/bin/env bash
                printf 'xdotool:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                if [ "$1" = search ] && [ "$2" = --pid ]; then
                  printf '%s2\n' "$3"
                  exit 0
                fi
                exit 2
                """,
            )
            write_executable(
                fakebin / "xprop",
                """\
                #!/usr/bin/env bash
                if [ "$1" = -id ] && [ "$3" = _NET_WM_DESKTOP ]; then
                  printf '_NET_WM_DESKTOP(CARDINAL) = 0\n'
                  exit 0
                fi
                exit 2
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_BOUNDED": "1",
                    "MULTI_CODEX_TEST_LOG": str(log),
                }
            )

            result = subprocess.run(
                [str(HELPER), "--missing"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertIn("duplicate Terminal 2 processes", result.stderr)
            calls = log.read_text(encoding="utf-8").splitlines()
            self.assertFalse(
                any(
                    line.startswith(("xdotool:windowsize ", "xdotool:windowmove "))
                    for line in calls
                )
            )

    def test_later_launch_failure_stops_only_units_created_this_run(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fakebin = root / "bin"
            fakebin.mkdir()
            log = root / "calls"
            helper = root / "layout-helper"
            write_executable(
                helper,
                """\
                #!/usr/bin/env bash
                printf 'layout:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                if [ "$1" != --missing ]; then
                  exit 2
                fi
                printf '2\n4\n5\n'
                """,
            )
            write_executable(
                fakebin / "systemd-run",
                """\
                #!/usr/bin/env bash
                unit=
                for argument in "$@"; do
                  case "$argument" in
                    --unit=*) unit=${argument#--unit=} ;;
                  esac
                done
                printf 'start:%s\n' "$unit" >> "$MULTI_CODEX_TEST_LOG"
                case "$unit" in
                  multi-codex-terminal-2|multi-codex-terminal-4) exit 0 ;;
                  multi-codex-terminal-5) exit 1 ;;
                  *) exit 2 ;;
                esac
                """,
            )
            write_executable(
                fakebin / "systemctl",
                """\
                #!/usr/bin/env bash
                printf 'stop' >> "$MULTI_CODEX_TEST_LOG"
                printf '\\t%s' "$@" >> "$MULTI_CODEX_TEST_LOG"
                printf '\n' >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_COMMAND": str(helper),
                    "MULTI_CODEX_TEST_LOG": str(log),
                }
            )

            result = subprocess.run(
                [str(RUNNER), "--panel"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertIn(
                "rolling back only the newly created sessions",
                result.stderr,
            )
            self.assertEqual(
                log.read_text(encoding="utf-8").splitlines(),
                [
                    "layout:--missing",
                    "start:multi-codex-terminal-2",
                    "start:multi-codex-terminal-4",
                    "start:multi-codex-terminal-5",
                    (
                        "stop\t--user\tstop"
                        "\tmulti-codex-terminal-2.service"
                        "\tmulti-codex-terminal-4.service"
                    ),
                ],
            )

    def test_panel_runner_retries_starting_until_windows_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fakebin = root / "bin"
            fakebin.mkdir()
            log = root / "calls"
            state = root / "layout-state"
            helper = root / "layout-helper"
            write_executable(
                helper,
                """\
                #!/usr/bin/env bash
                count=0
                if [ -f "$MULTI_CODEX_TEST_STATE" ]; then
                  read -r count < "$MULTI_CODEX_TEST_STATE"
                fi
                count=$((count + 1))
                printf '%s\n' "$count" > "$MULTI_CODEX_TEST_STATE"
                printf 'layout:%s:%s\n' "$count" "$*" >> "$MULTI_CODEX_TEST_LOG"
                case "$count" in
                  1)
                    [ "$1" = --missing ] || exit 2
                    printf '1\n2\n3\n4\n5\n6\n'
                    ;;
                  2)
                    [ "$1" = --check ] || exit 2
                    exit 4
                    ;;
                  3)
                    [ "$1" = --check ] || exit 2
                    exit 0
                    ;;
                  4)
                    [ "$1" = --panel ] || exit 2
                    exit 0
                    ;;
                  *)
                    exit 99
                    ;;
                esac
                """,
            )
            write_executable(
                fakebin / "systemd-run",
                """\
                #!/usr/bin/env bash
                unit=
                for argument in "$@"; do
                  case "$argument" in
                    --unit=*) unit=${argument#--unit=} ;;
                  esac
                done
                printf 'start:%s\n' "$unit" >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            write_executable(
                fakebin / "systemctl",
                """\
                #!/usr/bin/env bash
                printf 'stop:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_COMMAND": str(helper),
                    "MULTI_CODEX_TEST_LOG": str(log),
                    "MULTI_CODEX_TEST_STATE": str(state),
                }
            )

            result = subprocess.run(
                [str(RUNNER), "--panel"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "")
            self.assertEqual(
                log.read_text(encoding="utf-8").splitlines(),
                [
                    "layout:1:--missing",
                    "start:multi-codex-terminal-1",
                    "start:multi-codex-terminal-2",
                    "start:multi-codex-terminal-3",
                    "start:multi-codex-terminal-4",
                    "start:multi-codex-terminal-5",
                    "start:multi-codex-terminal-6",
                    "layout:2:--check",
                    "layout:3:--check",
                    "layout:4:--panel",
                ],
            )

    def test_panel_runner_fails_closed_on_fatal_probe_after_launch(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fakebin = root / "bin"
            fakebin.mkdir()
            log = root / "calls"
            state = root / "layout-state"
            helper = root / "layout-helper"
            write_executable(
                helper,
                """\
                #!/usr/bin/env bash
                count=0
                if [ -f "$MULTI_CODEX_TEST_STATE" ]; then
                  read -r count < "$MULTI_CODEX_TEST_STATE"
                fi
                count=$((count + 1))
                printf '%s\n' "$count" > "$MULTI_CODEX_TEST_STATE"
                printf 'layout:%s:%s\n' "$count" "$*" >> "$MULTI_CODEX_TEST_LOG"
                case "$count" in
                  1)
                    [ "$1" = --missing ] || exit 2
                    printf '2\n'
                    ;;
                  2)
                    [ "$1" = --check ] || exit 2
                    printf 'duplicate Terminal 2 process\n' >&2
                    exit 1
                    ;;
                  *)
                    printf 'unexpected retry\n' >> "$MULTI_CODEX_TEST_LOG"
                    exit 99
                    ;;
                esac
                """,
            )
            write_executable(
                fakebin / "systemd-run",
                """\
                #!/usr/bin/env bash
                printf 'start\n' >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            write_executable(
                fakebin / "systemctl",
                """\
                #!/usr/bin/env bash
                printf 'stop:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_COMMAND": str(helper),
                    "MULTI_CODEX_TEST_LOG": str(log),
                    "MULTI_CODEX_TEST_STATE": str(state),
                }
            )

            result = subprocess.run(
                [str(RUNNER), "--panel"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "rolling back only the newly created sessions",
                result.stderr,
            )
            self.assertEqual(
                log.read_text(encoding="utf-8").splitlines(),
                [
                    "layout:1:--missing",
                    "start",
                    "layout:2:--check",
                    (
                        "stop:--user stop "
                        "multi-codex-terminal-2.service"
                    ),
                ],
            )

    def test_non_panel_runner_does_not_retry_fatal_check(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fakebin = root / "bin"
            fakebin.mkdir()
            log = root / "calls"
            check_state = root / "check-state"
            helper = root / "layout-helper"
            write_executable(
                helper,
                """\
                #!/usr/bin/env bash
                printf 'layout:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                case "$1" in
                  --missing)
                    printf '1\n'
                    exit 0
                    ;;
                  --check)
                    if [ ! -e "$MULTI_CODEX_TEST_STATE" ]; then
                      : > "$MULTI_CODEX_TEST_STATE"
                      exit 1
                    fi
                    exit 0
                    ;;
                  *)
                    printf 'unexpected layout\n' >> "$MULTI_CODEX_TEST_LOG"
                    exit 99
                    ;;
                esac
                """,
            )
            write_executable(
                fakebin / "systemd-run",
                """\
                #!/usr/bin/env bash
                printf 'start\n' >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            write_executable(
                fakebin / "systemctl",
                """\
                #!/usr/bin/env bash
                printf 'stop:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_COMMAND": str(helper),
                    "MULTI_CODEX_TEST_LOG": str(log),
                    "MULTI_CODEX_TEST_STATE": str(check_state),
                }
            )

            result = subprocess.run(
                [str(RUNNER)],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertEqual(
                log.read_text(encoding="utf-8").splitlines(),
                [
                    "layout:--missing",
                    "start",
                    "layout:--check",
                    (
                        "stop:--user stop "
                        "multi-codex-terminal-1.service"
                    ),
                ],
            )

    def test_production_cleanup_has_no_glob_or_process_wide_kill(
        self,
    ) -> None:
        for script in (RUNNER, HELPER):
            source = script.read_text(encoding="utf-8")
            with self.subTest(script=script.name):
                self.assertNotRegex(source, r"\b(?:pkill|killall)\b")
                self.assertNotRegex(
                    source,
                    r"(?m)^[ \t]*systemctl\b[^\n]*[*?]",
                )

    def test_relocated_panel_helper_probes_before_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            fakebin = temporary_root / "bin"
            fakebin.mkdir()
            extension_copy = temporary_root / "extension copy with spaces"
            shutil.copytree(ROOT / "extension", extension_copy)
            relocated_helper = (
                extension_copy / "scripts" / "open-six-terminals"
            )
            log = temporary_root / "calls"
            write_executable(
                fakebin / "pgrep",
                """\
                #!/usr/bin/env bash
                slot=${!#}
                slot=${slot%$}
                slot=${slot##*Terminal }
                printf 'pgrep:%s\n' "$slot" >> "$MULTI_CODEX_TEST_LOG"
                printf '10%s\n' "$slot"
                """,
            )
            write_executable(
                fakebin / "xdotool",
                """\
                #!/usr/bin/env bash
                printf 'xdotool:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                case "$1" in
                  search)
                    printf '%s1\n%s2\n' "$3" "$3"
                    ;;
                  windowsize|windowmove)
                    ;;
                  *)
                    exit 2
                    ;;
                esac
                """,
            )
            write_executable(
                fakebin / "xprop",
                """\
                #!/usr/bin/env bash
                printf 'xprop:%s\n' "$*" >> "$MULTI_CODEX_TEST_LOG"
                if [ "$1" = -root ] &&
                    [ "$2" = _NET_WORKAREA ]; then
                  printf '_NET_WORKAREA(CARDINAL) = 0, 44, 3440, 1325\n'
                elif [ "$1" = -root ] &&
                    [ "$2" = _NET_CURRENT_DESKTOP ]; then
                  printf '_NET_CURRENT_DESKTOP(CARDINAL) = 0\n'
                elif [ "$1" = -id ]; then
                  case "$2" in
                    *1) printf '_NET_WM_DESKTOP:  not found.\n' ;;
                    *2) printf '_NET_WM_DESKTOP(CARDINAL) = 0\n' ;;
                    *) exit 2 ;;
                  esac
                else
                  exit 2
                fi
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_BOUNDED": "1",
                    "MULTI_CODEX_TEST_LOG": str(log),
                }
            )

            result = subprocess.run(
                [str(relocated_helper), "--panel"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=5,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            calls = log.read_text(encoding="utf-8").splitlines()
            self.assertEqual(
                sorted(line for line in calls if line.startswith("pgrep:")),
                [f"pgrep:{slot}" for slot in range(1, 7)],
            )
            self.assertEqual(
                sum(line.startswith("xdotool:search ") for line in calls),
                6,
            )
            self.assertEqual(
                sum(
                    line.startswith("xprop:-id ")
                    and line.endswith(" _NET_WM_DESKTOP")
                    for line in calls
                ),
                12,
            )
            self.assertEqual(
                sum(line.startswith("xdotool:windowsize ") for line in calls),
                6,
            )
            self.assertEqual(
                sum(line.startswith("xdotool:windowmove ") for line in calls),
                6,
            )

    def test_complete_probe_does_not_time_each_leaf_command(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fakebin = Path(directory)
            write_executable(
                fakebin / "timeout",
                """\
                #!/usr/bin/env bash
                printf 'unexpected per-command timeout\n' >&2
                exit 97
                """,
            )
            write_executable(
                fakebin / "pgrep",
                """\
                #!/usr/bin/env bash
                slot=${!#}
                slot=${slot%$}
                slot=${slot##*Terminal }
                printf '10%s\n' "$slot"
                """,
            )
            write_executable(
                fakebin / "xdotool",
                """\
                #!/usr/bin/env bash
                if [ "$1" != search ] || [ "$2" != --pid ]; then
                  exit 2
                fi
                printf '%s1\n%s2\n' "$3" "$3"
                """,
            )
            write_executable(
                fakebin / "xprop",
                """\
                #!/usr/bin/env bash
                window_id=$2
                case "$window_id" in
                  *1) printf '_NET_WM_DESKTOP:  not found.\n' ;;
                  *2) printf '_NET_WM_DESKTOP(CARDINAL) = 0\n' ;;
                  *) exit 2 ;;
                esac
                """,
            )
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fakebin}:/usr/bin:/bin",
                    "MULTI_CODEX_LAYOUT_BOUNDED": "1",
                }
            )

            result = subprocess.run(
                [str(HELPER), "--check"],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)

    def test_runner_uses_one_deadline_executor(self) -> None:
        source = RUNNER.read_text(encoding="utf-8")

        self.assertEqual(
            source.count("local remaining=$((deadline - SECONDS))"),
            1,
        )
        self.assertNotIn("run_layout_before_deadline()", source)
        self.assertIn("env MULTI_CODEX_LAYOUT_BOUNDED=1", source)


if __name__ == "__main__":
    unittest.main()
