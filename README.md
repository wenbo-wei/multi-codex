# Multi Codex

Multi Codex is a small GNOME Shell extension that creates, recalls, and
arranges six Ptyxis terminals in a 3-by-2 grid. **Multi Codex** is the project
and repository name; the extension adds one **Workspace** button to the GNOME
panel.

The extension is intended as a workspace for multiple Codex sessions. It
opens plain terminal windows; it does not start or authenticate Codex itself.

## Behaviour

- Reuses a complete, unique set of six existing terminals.
- Creates only missing terminal slots and preserves existing sessions.
- Places new windows before their first visible frame to avoid a centre-screen
  flash.
- Moves the complete set to the active workspace and focuses one terminal.
- Fails closed on duplicate or ambiguous terminal identities.
- Places its panel button beside the local Codex dashboard when available,
  with the GNOME date menu as a fallback.

## Supported environment

Multi Codex currently targets GNOME Shell 50 and Ptyxis installed at
`/usr/bin/ptyxis`. It has been tested on Ubuntu GNOME 50.1 in a Wayland session
with XWayland.

Runtime dependencies:

- Bash and GNU coreutils (`env`, `timeout`)
- GJS
- a systemd user session (`systemctl`, `systemd-run`)
- procps (`pgrep`)
- Ptyxis
- `xdotool` and `xprop`
- Linux `/proc` and XWayland/X11 support

The current geometry adapter is designed for the tested single-monitor setup.
Multi-monitor support has not been validated.

## Build and package

Build dependencies are GNU Make, Git, GNOME's `gnome-extensions` tool,
`unzip`, `zip`, and standard GNU file utilities. A source archive without Git
metadata can set `SOURCE_DATE_EPOCH` explicitly; otherwise packaging uses the
latest commit timestamp.

```sh
make package
```

The package is written to:

```text
dist/multi-codex@wenbo.shell-extension.zip
```

## Install

Install the package:

```sh
gnome-extensions install --force \
  dist/multi-codex@wenbo.shell-extension.zip
```

Then enable it:

```sh
gnome-extensions enable multi-codex@wenbo
```

GNOME Shell may require a logout and login before a newly installed extension
UUID can be loaded.

### Migrating from Workspace

`multi-codex@wenbo` is a new extension identity. Do not enable it at the same
time as the legacy `workspace@wenbo` extension; both would manage the same
terminal windows.

Disable the legacy extension before enabling the new extension:

```sh
gnome-extensions disable workspace@wenbo
gnome-extensions enable multi-codex@wenbo
```

Installation does not remove the legacy extension or modify the running GNOME
session automatically.

## Repository layout

- `extension/` — files shipped in the GNOME extension package
- `tools/package.sh` — reproducible package builder

## License

No open-source license has been granted. See `LICENSE`.
