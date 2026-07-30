from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import textwrap
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
SCRIPTS = EXTENSION / "scripts"
FORBIDDEN_PATTERN_FILE = ROOT / "tools" / "forbidden-runtime-patterns"
FORBIDDEN_RUNTIME_PATTERNS = tuple(
    re.compile(line)
    for line in FORBIDDEN_PATTERN_FILE.read_text(encoding="utf-8").splitlines()
    if line
)


class RepositoryTests(unittest.TestCase):
    def test_metadata_uses_public_identity(self) -> None:
        metadata = json.loads(
            (EXTENSION / "metadata.json").read_text(encoding="utf-8")
        )

        self.assertEqual(metadata["uuid"], "multi-codex@wenbo")
        self.assertEqual(metadata["name"], "Multi Codex")
        self.assertEqual(metadata["version"], 1)
        self.assertEqual(metadata["shell-version"], ["50"])

    def test_runtime_is_machine_independent(self) -> None:
        runtime_files = [
            path
            for path in EXTENSION.rglob("*")
            if path.is_file()
        ]

        self.assertGreaterEqual(len(runtime_files), 9)
        for path in runtime_files:
            source = path.read_text(encoding="utf-8")
            for pattern in FORBIDDEN_RUNTIME_PATTERNS:
                self.assertIsNone(
                    pattern.search(source),
                    str(path.relative_to(ROOT)),
                )

        extension_source = (EXTENSION / "extension.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("this.path", extension_source)
        self.assertIn("runtimeCommandArgv", extension_source)

    def test_forbidden_patterns_reject_machine_specific_paths(self) -> None:
        for value in (
            "/home/alice/.local/bin/helper",
            "/Users/alice/Library/helper",
            "/root/.local/bin/helper",
        ):
            self.assertTrue(
                any(
                    pattern.search(value)
                    for pattern in FORBIDDEN_RUNTIME_PATTERNS
                ),
                value,
            )

    def test_package_checker_rejects_a_machine_home_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory) / "repository"
            temporary_tools = temporary_root / "tools"
            temporary_tools.mkdir(parents=True)
            shutil.copytree(EXTENSION, temporary_root / "extension")
            for name in (
                "check-package.sh",
                "forbidden-runtime-patterns",
                "package.sh",
            ):
                shutil.copy2(
                    ROOT / "tools" / name,
                    temporary_tools / name,
                )
            extension_source = temporary_root / "extension" / "extension.js"
            extension_source.write_text(
                extension_source.read_text(encoding="utf-8")
                + "\n// /home/alice/.local/bin/machine-helper\n",
                encoding="utf-8",
            )
            output = Path(directory) / "dist"
            environment = os.environ.copy()
            environment["SOURCE_DATE_EPOCH"] = "1785369600"
            subprocess.run(
                [str(temporary_tools / "package.sh"), str(output)],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=10,
                check=True,
            )

            result = subprocess.run(
                [
                    str(temporary_tools / "check-package.sh"),
                    str(
                        output
                        / "multi-codex@wenbo.shell-extension.zip"
                    ),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=10,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "legacy path or unrelated source",
                result.stderr,
            )

    def test_runtime_scripts_are_executable(self) -> None:
        for name in ("multi-codex", "open-six-terminals"):
            self.assertTrue(os.access(SCRIPTS / name, os.X_OK), name)

    def test_package_is_reproducible_across_source_mtimes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory) / "repository"
            temporary_tools = temporary_root / "tools"
            temporary_tools.mkdir(parents=True)
            shutil.copytree(EXTENSION, temporary_root / "extension")
            shutil.copy2(
                ROOT / "tools" / "package.sh",
                temporary_tools / "package.sh",
            )
            environment = os.environ.copy()
            environment["SOURCE_DATE_EPOCH"] = "1785369600"

            packages = []
            for build, timestamp in enumerate((946684800, 1893456000), 1):
                for path in (temporary_root / "extension").rglob("*"):
                    os.utime(path, (timestamp, timestamp))
                output = Path(directory) / f"dist-{build}"
                subprocess.run(
                    [str(temporary_tools / "package.sh"), str(output)],
                    env=environment,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=10,
                    check=True,
                )
                packages.append(
                    (
                        output
                        / "multi-codex@wenbo.shell-extension.zip"
                    ).read_bytes()
                )
                if build == 1:
                    time.sleep(1.1)

            self.assertEqual(packages[0], packages[1])

    def test_runner_finds_bundled_helper_from_arbitrary_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory) / "copy with spaces"
            temporary_scripts = temporary_root / "scripts"
            shutil.copytree(SCRIPTS, temporary_scripts)
            log = Path(directory) / "calls"
            helper = temporary_scripts / "open-six-terminals"
            helper.write_text(
                textwrap.dedent(
                    """\
                    #!/usr/bin/env bash
                    printf '%s|%s\n' \
                      "${MULTI_CODEX_LAYOUT_BOUNDED:-}" "$*" \
                      >> "$MULTI_CODEX_TEST_LOG"
                    exit 0
                    """
                ),
                encoding="utf-8",
            )
            helper.chmod(0o755)
            environment = os.environ.copy()
            environment["MULTI_CODEX_TEST_LOG"] = str(log)

            result = subprocess.run(
                [str(temporary_scripts / "multi-codex"), "--panel"],
                cwd="/",
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=3,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                log.read_text(encoding="utf-8").splitlines(),
                ["1|--missing", "1|--check", "1|--panel"],
            )

    def test_repository_does_not_track_generated_python_cache(self) -> None:
        result = subprocess.run(
            ["git", "ls-files", "--", "*__pycache__*", "*.pyc"],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3,
            check=True,
        )

        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
