# Multi Codex

Multi Codex is a standalone GNOME Shell extension that adds a **Workspace**
button to the panel. The button creates, recalls, and arranges six independent
Ptyxis terminals in a 3-by-2 grid. It does not start, resume, or control Codex
sessions inside those terminals.

The extension UUID is `multi-codex@wenbo`. It does not require Codex Dashboard
or any AppIndicator extension.

## Supported environment

Multi Codex currently supports this exact desktop stack:

- GNOME Shell 50;
- Ptyxis with `--standalone` support;
- XWayland and a working Ptyxis X11 backend;
- a running `systemd --user` manager;
- Bash, GJS, GNU `timeout`, `pgrep`, `xdotool`, and `xprop`.

The installer checks these commands before changing files:

```text
bash gjs gnome-extensions gnome-shell grep pgrep ptyxis sed sleep
systemctl systemd-run timeout xdotool xprop Xwayland
```

On Ubuntu, the corresponding packages include `gnome-shell`, `gjs`, `ptyxis`,
`xwayland`, `systemd`, `coreutils`, `procps`, `xdotool`, and `x11-utils`.
Package names differ on other distributions. GNOME versions other than 50 and
terminal emulators other than Ptyxis are not currently supported.

## Install from Git

No root access is used by the installer. It writes only to the normal user
extension directory under `$XDG_DATA_HOME` or `~/.local/share`.

```sh
git clone https://github.com/wenbo-wei/multi-codex.git
cd multi-codex
./scripts/install.sh
```

On a clean install, the UUID is added to GNOME Shell settings immediately. If
the running Shell has not discovered the new files yet, it will load the
extension automatically at the next sign-in; the installer does not need to be
rerun.

The installer also recognizes the legacy `workspace@wenbo` UUID. A working
legacy extension is never disabled until the new UUID is both discovered and
confirmed active. If the current Shell has not discovered the new UUID, the
new files are staged while the legacy extension remains enabled. Sign out,
sign back in, and rerun the installer to finish that migration. Legacy files
are preserved.

## Update

```sh
cd multi-codex
git pull --ff-only
./scripts/install.sh
```

The extension directory is replaced transactionally. If activation or settings
migration fails, the previous `multi-codex@wenbo` directory and the exact prior
GNOME enabled/disabled lists are restored.

GNOME Shell can keep an already loaded extension in memory during an update.
Sign out and back in when convenient to load the new JavaScript.

## Uninstall

Run the uninstaller from a clone of this repository:

```sh
cd multi-codex
./scripts/uninstall.sh
```

Only files owned by this release are removed. Unknown files, legacy
`workspace@wenbo` files, existing Ptyxis windows, and terminal sessions are
preserved.

## Development and packaging

```sh
make check
make package
make verify
```

`make package` creates
`dist/multi-codex@wenbo.shell-extension.zip`. Packaging is deterministic for a
fixed Git commit or `SOURCE_DATE_EPOCH`. `make verify` checks the archive
contents, license, file bytes, metadata, and executable script modes.

Repository layout:

- `extension/` — GNOME Shell code and source-relative runtime scripts;
- `scripts/` — noninteractive Git install, uninstall, and settings migration;
- `tools/` — deterministic package creation and verification.

## License

MIT
