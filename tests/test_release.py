from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest


REPOSITORY = Path(__file__).resolve().parents[1]
EXTENSION_UUID = "multi-codex@wenbo"
LEGACY_UUID = "workspace@wenbo"
OWNED_FILES = (
    "extension.js",
    "metadata.json",
    "stylesheet.css",
    "workspaceLayout.mjs",
    "workspaceLayoutCli.mjs",
    "workspaceWindowPlacement.mjs",
    "workspaceWindowSet.mjs",
    "scripts/multi-codex",
    "scripts/open-six-terminals",
)
REAL_GJS = shutil.which("gjs")
REAL_GSETTINGS = shutil.which("gsettings")


GJS_MOCK = r"""#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

NEW = "multi-codex@wenbo"
LEGACY = "workspace@wenbo"
root = Path(os.environ["MOCK_STATE_DIR"])
root.mkdir(parents=True, exist_ok=True)
enabled_path = root / "enabled"
disabled_path = root / "disabled"

def read(path):
    if not path.exists():
        return []
    return [line for line in path.read_text().splitlines() if line]

def write(path, values):
    path.write_text("".join(f"{value}\n" for value in dict.fromkeys(values)))

def write_exact(path, values):
    path.write_text("".join(f"{value}\n" for value in values))

enabled = read(enabled_path)
disabled = read(disabled_path)
arguments = sys.argv[3:]
if not arguments:
    raise SystemExit(2)
operation = arguments[0]
if (root / "fail-operation").exists():
    if (root / "fail-operation").read_text().strip() == operation:
        raise SystemExit(1)

if operation == "snapshot":
    if len(arguments) != 2:
        raise SystemExit(2)
    Path(arguments[1]).write_text(json.dumps({
        "enabled": enabled,
        "disabled": disabled,
    }))
    raise SystemExit(0)
if operation == "restore":
    if len(arguments) != 2:
        raise SystemExit(2)
    saved = json.loads(Path(arguments[1]).read_text())
    write_exact(enabled_path, saved["enabled"])
    write_exact(disabled_path, saved["disabled"])
    if NEW not in saved["enabled"]:
        (root / "new-active").unlink(missing_ok=True)
    raise SystemExit(0)
if operation == "legacy-enabled":
    raise SystemExit(0 if LEGACY in enabled else 3)
if operation == "queue-clean":
    if LEGACY in enabled:
        raise SystemExit(1)
    enabled = [value for value in enabled if value != NEW] + [NEW]
    disabled = [
        value for value in disabled if value not in (NEW, LEGACY)
    ] + [LEGACY]
    if os.environ.get("MOCK_ACTIVATE_ON_QUEUE") == "1":
        (root / "new-active").touch()
elif operation == "prepare-migration":
    if LEGACY not in enabled:
        raise SystemExit(1)
    enabled = [value for value in enabled if value != NEW] + [NEW]
    disabled = [value for value in disabled if value != NEW]
    if os.environ.get("MOCK_ACTIVATE_ON_PREPARE") == "1":
        (root / "new-active").touch()
elif operation == "retire-legacy":
    if NEW not in enabled:
        raise SystemExit(1)
    enabled = [value for value in enabled if value != LEGACY]
    disabled = [value for value in disabled if value != LEGACY] + [LEGACY]
elif operation == "uninstall":
    enabled = [value for value in enabled if value != NEW]
    disabled = [value for value in disabled if value != NEW] + [NEW]
else:
    raise SystemExit(2)

write(enabled_path, enabled)
write(disabled_path, disabled)
"""


GNOME_EXTENSIONS_MOCK = r"""#!/usr/bin/env python3
import os
from pathlib import Path
import sys

root = Path(os.environ["MOCK_STATE_DIR"])
command = sys.argv[1:]
if command[:1] == ["info"]:
    raise SystemExit(0 if os.environ.get("MOCK_DISCOVERED") == "1" else 1)
if command == ["list", "--active"]:
    if os.environ.get("MOCK_LIST_FAIL") == "1":
        raise SystemExit(1)
    if (root / "new-active").exists():
        print("multi-codex@wenbo")
    raise SystemExit(0)
raise SystemExit(2)
"""


class ReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="multi codex release."
        )
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.data_home = self.root / "data"
        self.state = self.root / "state"
        self.mock_bin = self.root / "bin"
        for directory in (
            self.home,
            self.data_home,
            self.state,
            self.mock_bin,
        ):
            directory.mkdir(parents=True)
        self._write_executable("gjs", GJS_MOCK)
        self._write_executable(
            "gnome-extensions",
            GNOME_EXTENSIONS_MOCK,
        )
        self._write_executable(
            "gnome-shell",
            "#!/bin/sh\nprintf 'GNOME Shell 50.1\\n'\n",
        )
        for command in (
            "ptyxis",
            "sleep",
            "systemctl",
            "systemd-run",
            "xdotool",
            "xprop",
            "Xwayland",
        ):
            self._write_executable(command, "#!/bin/sh\nexit 0\n")
        self.environment = os.environ.copy()
        self.environment.update(
            {
                "HOME": str(self.home),
                "XDG_DATA_HOME": str(self.data_home),
                "MOCK_STATE_DIR": str(self.state),
                "PATH": f"{self.mock_bin}:/usr/bin:/bin",
            }
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_executable(self, name: str, content: str) -> None:
        path = self.mock_bin / name
        path.write_text(textwrap.dedent(content), encoding="utf-8")
        path.chmod(0o755)

    @property
    def extension_dir(self) -> Path:
        return (
            self.data_home
            / "gnome-shell"
            / "extensions"
            / EXTENSION_UUID
        )

    @property
    def legacy_dir(self) -> Path:
        return (
            self.data_home
            / "gnome-shell"
            / "extensions"
            / LEGACY_UUID
        )

    def _settings(self, name: str) -> list[str]:
        path = self.state / name
        if not path.exists():
            return []
        return [line for line in path.read_text().splitlines() if line]

    def _run(self, script: str, **environment: str) -> subprocess.CompletedProcess:
        merged = self.environment | environment
        return subprocess.run(
            [str(REPOSITORY / "scripts" / script)],
            cwd=REPOSITORY,
            env=merged,
            stdin=subprocess.DEVNULL,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )

    def _assert_owned_files_match(self) -> None:
        for relative_path in OWNED_FILES:
            self.assertEqual(
                (REPOSITORY / "extension" / relative_path).read_bytes(),
                (self.extension_dir / relative_path).read_bytes(),
                relative_path,
            )

    def test_repository_identity_and_independence(self) -> None:
        metadata = json.loads(
            (REPOSITORY / "extension" / "metadata.json").read_text()
        )
        self.assertEqual(metadata["uuid"], EXTENSION_UUID)
        self.assertEqual(metadata["shell-version"], ["50"])
        self.assertGreaterEqual(metadata["version"], 2)
        source = (REPOSITORY / "extension" / "extension.js").read_text()
        self.assertNotIn("codex-quota-centre@local", source)
        self.assertNotIn("CODEX_SOURCE_INDICATOR_ID", source)
        self.assertTrue((REPOSITORY / "LICENSE").read_text().startswith("MIT"))

    @unittest.skipUnless(
        REAL_GJS and REAL_GSETTINGS,
        "GJS and GSettings are required for the real settings test",
    )
    def test_real_settings_helper_transitions_are_isolated(self) -> None:
        config_home = self.root / "settings config"
        config_home.mkdir()
        environment = os.environ | {
            "GSETTINGS_BACKEND": "keyfile",
            "XDG_CONFIG_HOME": str(config_home),
        }

        def gsettings(*arguments: str) -> str:
            return subprocess.run(
                [REAL_GSETTINGS, *arguments],
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            ).stdout.strip()

        def helper(*arguments: str) -> None:
            subprocess.run(
                [
                    REAL_GJS,
                    "-m",
                    str(REPOSITORY / "scripts" / "extension-settings.mjs"),
                    *arguments,
                ],
                env=environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
            )

        gsettings(
            "set",
            "org.gnome.shell",
            "enabled-extensions",
            f"['keep@example', '{LEGACY_UUID}']",
        )
        gsettings(
            "set",
            "org.gnome.shell",
            "disabled-extensions",
            f"['{EXTENSION_UUID}', 'disabled@example']",
        )

        snapshot = self.root / "settings-snapshot.json"
        helper("snapshot", str(snapshot))
        helper("prepare-migration")
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "enabled-extensions"),
            f"['keep@example', '{LEGACY_UUID}', '{EXTENSION_UUID}']",
        )
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "disabled-extensions"),
            "['disabled@example']",
        )

        helper("restore", str(snapshot))
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "enabled-extensions"),
            f"['keep@example', '{LEGACY_UUID}']",
        )
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "disabled-extensions"),
            f"['{EXTENSION_UUID}', 'disabled@example']",
        )

        helper("prepare-migration")
        helper("retire-legacy")
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "enabled-extensions"),
            f"['keep@example', '{EXTENSION_UUID}']",
        )
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "disabled-extensions"),
            f"['disabled@example', '{LEGACY_UUID}']",
        )

        helper("uninstall")
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "enabled-extensions"),
            "['keep@example']",
        )
        self.assertEqual(
            gsettings("get", "org.gnome.shell", "disabled-extensions"),
            f"['disabled@example', '{LEGACY_UUID}', '{EXTENSION_UUID}']",
        )

    def test_clean_upgrade_preserves_unknown_files(self) -> None:
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("old\n")
        (self.extension_dir / "custom-user-file").write_text("preserve\n")

        result = self._run("install.sh")

        self.assertEqual(result.returncode, 0, result.stderr)
        self._assert_owned_files_match()
        self.assertEqual(
            (self.extension_dir / "custom-user-file").read_text(),
            "preserve\n",
        )
        self.assertEqual(self._settings("enabled"), [EXTENSION_UUID])
        self.assertIn(LEGACY_UUID, self._settings("disabled"))

    def test_clean_settings_failure_restores_exact_state_and_files(self) -> None:
        original_enabled = ["keep@example"]
        original_disabled = [EXTENSION_UUID, "disabled@example"]
        (self.state / "enabled").write_text("\n".join(original_enabled) + "\n")
        (self.state / "disabled").write_text(
            "\n".join(original_disabled) + "\n"
        )
        (self.state / "fail-operation").write_text("queue-clean\n")
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("previous\n")
        (self.extension_dir / "unknown").write_text("preserve\n")

        result = self._run("install.sh")

        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            (self.extension_dir / "extension.js").read_text(),
            "previous\n",
        )
        self.assertEqual(
            (self.extension_dir / "unknown").read_text(),
            "preserve\n",
        )
        self.assertEqual(self._settings("enabled"), original_enabled)
        self.assertEqual(self._settings("disabled"), original_disabled)

    def test_discovered_clean_activation_failure_rolls_back(self) -> None:
        original_enabled = ["keep@example"]
        original_disabled = [EXTENSION_UUID, "disabled@example"]
        (self.state / "enabled").write_text("\n".join(original_enabled) + "\n")
        (self.state / "disabled").write_text(
            "\n".join(original_disabled) + "\n"
        )
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("previous\n")
        (self.extension_dir / "unknown").write_text("preserve\n")

        result = self._run("install.sh", MOCK_DISCOVERED="1")

        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            (self.extension_dir / "extension.js").read_text(),
            "previous\n",
        )
        self.assertEqual(
            (self.extension_dir / "unknown").read_text(),
            "preserve\n",
        )
        self.assertEqual(self._settings("enabled"), original_enabled)
        self.assertEqual(self._settings("disabled"), original_disabled)

    def test_discovered_clean_install_confirms_activation(self) -> None:
        result = self._run(
            "install.sh",
            MOCK_DISCOVERED="1",
            MOCK_ACTIVATE_ON_QUEUE="1",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self._assert_owned_files_match()
        self.assertEqual(self._settings("enabled"), [EXTENSION_UUID])
        self.assertIn(LEGACY_UUID, self._settings("disabled"))

    def test_install_rejects_extension_directory_symlink(self) -> None:
        outside = self.root / "outside-extension"
        outside.mkdir()
        protected = outside / "extension.js"
        protected.write_text("do not touch\n")
        self.extension_dir.parent.mkdir(parents=True)
        self.extension_dir.symlink_to(outside, target_is_directory=True)

        result = self._run("install.sh")

        self.assertEqual(result.returncode, 1)
        self.assertTrue(self.extension_dir.is_symlink())
        self.assertEqual(protected.read_text(), "do not touch\n")
        self.assertEqual(self._settings("enabled"), [])
        self.assertEqual(self._settings("disabled"), [])

    def test_install_preserves_conflicting_scripts_symlink(self) -> None:
        outside = self.root / "outside-scripts"
        outside.mkdir()
        protected = outside / "user-script"
        protected.write_text("do not touch\n")
        self.extension_dir.mkdir(parents=True)
        scripts_path = self.extension_dir / "scripts"
        scripts_path.symlink_to(outside, target_is_directory=True)

        result = self._run("install.sh")

        self.assertEqual(result.returncode, 1)
        self.assertTrue(scripts_path.is_symlink())
        self.assertEqual(protected.read_text(), "do not touch\n")
        self.assertEqual(self._settings("enabled"), [])
        self.assertEqual(self._settings("disabled"), [])

    def test_undiscovered_migration_stages_without_settings_change(self) -> None:
        (self.state / "enabled").write_text(f"{LEGACY_UUID}\n")
        self.legacy_dir.mkdir(parents=True)
        (self.legacy_dir / "legacy-file").write_text("preserve\n")

        result = self._run("install.sh", MOCK_DISCOVERED="0")

        self.assertEqual(result.returncode, 2, result.stderr)
        self._assert_owned_files_match()
        self.assertEqual(self._settings("enabled"), [LEGACY_UUID])
        self.assertNotIn(EXTENSION_UUID, self._settings("enabled"))
        self.assertTrue((self.legacy_dir / "legacy-file").exists())

    def test_retire_failure_rolls_back_settings_and_files(self) -> None:
        original_enabled = ["keep@example", LEGACY_UUID]
        original_disabled = [EXTENSION_UUID, "disabled@example"]
        (self.state / "enabled").write_text("\n".join(original_enabled) + "\n")
        (self.state / "disabled").write_text(
            "\n".join(original_disabled) + "\n"
        )
        (self.state / "fail-operation").write_text("retire-legacy\n")
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("previous\n")
        (self.extension_dir / "unknown").write_text("preserve\n")

        result = self._run(
            "install.sh",
            MOCK_DISCOVERED="1",
            MOCK_ACTIVATE_ON_PREPARE="1",
        )

        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            (self.extension_dir / "extension.js").read_text(),
            "previous\n",
        )
        self.assertEqual(
            (self.extension_dir / "unknown").read_text(),
            "preserve\n",
        )
        self.assertEqual(self._settings("enabled"), original_enabled)
        self.assertEqual(self._settings("disabled"), original_disabled)

    def test_active_probe_failure_restores_exact_state_and_files(self) -> None:
        original_enabled = ["keep@example", LEGACY_UUID]
        original_disabled = [EXTENSION_UUID, "disabled@example"]
        (self.state / "enabled").write_text("\n".join(original_enabled) + "\n")
        (self.state / "disabled").write_text(
            "\n".join(original_disabled) + "\n"
        )
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("previous\n")
        (self.extension_dir / "unknown").write_text("preserve\n")

        result = self._run(
            "install.sh",
            MOCK_DISCOVERED="1",
            MOCK_LIST_FAIL="1",
        )

        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            (self.extension_dir / "extension.js").read_text(),
            "previous\n",
        )
        self.assertEqual(
            (self.extension_dir / "unknown").read_text(),
            "preserve\n",
        )
        self.assertEqual(self._settings("enabled"), original_enabled)
        self.assertEqual(self._settings("disabled"), original_disabled)

    def test_successful_migration_and_safe_uninstall(self) -> None:
        (self.state / "enabled").write_text(f"{LEGACY_UUID}\n")
        self.legacy_dir.mkdir(parents=True)
        (self.legacy_dir / "legacy-file").write_text("preserve\n")

        install_result = self._run(
            "install.sh",
            MOCK_DISCOVERED="1",
            MOCK_ACTIVATE_ON_PREPARE="1",
        )

        self.assertEqual(install_result.returncode, 0, install_result.stderr)
        self.assertEqual(self._settings("enabled"), [EXTENSION_UUID])
        self.assertIn(LEGACY_UUID, self._settings("disabled"))
        (self.extension_dir / "unknown").write_text("preserve\n")

        uninstall_result = self._run("uninstall.sh")

        self.assertEqual(
            uninstall_result.returncode,
            0,
            uninstall_result.stderr,
        )
        for relative_path in OWNED_FILES:
            self.assertFalse(
                (self.extension_dir / relative_path).exists(),
                relative_path,
            )
        self.assertEqual(
            (self.extension_dir / "unknown").read_text(),
            "preserve\n",
        )
        self.assertTrue((self.legacy_dir / "legacy-file").exists())
        self.assertNotIn(EXTENSION_UUID, self._settings("enabled"))

    def test_uninstall_preserves_symlinked_scripts_directory(self) -> None:
        outside = self.root / "outside-scripts"
        outside.mkdir()
        protected = outside / "multi-codex"
        protected.write_text("do not touch\n")
        self.extension_dir.mkdir(parents=True)
        (self.extension_dir / "extension.js").write_text("owned\n")
        (self.extension_dir / "scripts").symlink_to(
            outside,
            target_is_directory=True,
        )
        (self.state / "enabled").write_text(f"{EXTENSION_UUID}\n")

        result = self._run("uninstall.sh")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(protected.read_text(), "do not touch\n")
        self.assertTrue((self.extension_dir / "scripts").is_symlink())
        self.assertNotIn(EXTENSION_UUID, self._settings("enabled"))


if __name__ == "__main__":
    unittest.main()
