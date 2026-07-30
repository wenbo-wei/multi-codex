# Multi Codex standalone repository

## Objective

Extract the currently installed Workspace v9 implementation into a small,
self-contained Git repository named `multi-codex`, and rename the product to
**Multi Codex** without changing its six-terminal behaviour.

## Requirements

1. The repository name is `multi-codex`, the visible extension name is
   `Multi Codex`, and the new extension UUID is `multi-codex@wenbo`.
2. All files required at runtime ship inside one GNOME extension bundle.
   Runtime code must not depend on `/home/wenbo`, separately installed helper
   scripts, or the checkout location.
3. The behaviour and safety invariants in
   `docs/specs/workspace-initial-placement.md` remain intact:
   exact process identity, missing-slot-only creation, canonical 3-by-2
   placement, pre-paint holding, visibility-safe failure, and precise rollback.
4. Panel activation must retain the no-flicker path: the X11 helper changes
   geometry only, while GNOME Shell performs workspace, visibility, stacking,
   and final focus operations.
5. Integration with `codex-quota-centre@local` remains optional. When it is
   absent, the button falls back to placement beside the GNOME date menu.
6. The supported GNOME, Ptyxis, X11, systemd, and command-line dependencies
   are documented honestly. The documentation must state that Multi Codex
   opens terminals but does not itself launch Codex.
7. The repository includes a conservative license notice, coding standards,
   ignore rules, one-command pure tests, reproducible packaging, package
   content verification, and an isolated GNOME Shell smoke test.
8. The produced package contains every runtime module and executable helper,
   contains no tests, caches, machine-specific paths, or unrelated Codex Quota
   files, and loads under the new UUID in an isolated GNOME Shell session.
9. Migration is safe: building or installing the package must not
   automatically disable, remove, or overwrite the legacy `workspace@wenbo`
   installation. Documentation must warn against enabling both identities.
10. This repository task must not restart GNOME Shell, log out the user, open
    visible windows, or alter the currently installed Workspace extension.

## Verification

- All existing pure Workspace tests pass after path and naming adaptation.
- Repository hygiene and relocatability tests pass.
- Shell syntax checks pass.
- `gnome-extensions pack` produces the expected complete bundle.
- The production extension reports `ACTIVE` in an isolated headless GNOME
  Shell session.
- Review uses the `workspace-v9-baseline` tag as its fixed point.
