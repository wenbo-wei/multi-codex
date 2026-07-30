from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
SCRIPTS = EXTENSION / "scripts"


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
        forbidden = ("/home/wenbo", "workspace@wenbo")
        runtime_files = [
            path
            for path in EXTENSION.rglob("*")
            if path.is_file()
        ]

        self.assertGreaterEqual(len(runtime_files), 9)
        for path in runtime_files:
            source = path.read_text(encoding="utf-8")
            for value in forbidden:
                self.assertNotIn(value, source, str(path.relative_to(ROOT)))

        extension_source = (EXTENSION / "extension.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("this.path", extension_source)
        self.assertIn("'scripts'", extension_source)
        self.assertIn("COMMAND_FILENAME", extension_source)

    def test_runtime_scripts_are_executable(self) -> None:
        for name in ("multi-codex", "open-six-terminals"):
            self.assertTrue(os.access(SCRIPTS / name, os.X_OK), name)

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
