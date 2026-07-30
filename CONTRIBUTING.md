# Contributing

## Coding standards

- Keep all shipped runtime files under `extension/`.
- Resolve bundled runtime paths from the installed extension or script
  location. Never add a user-specific home path.
- Preserve exact terminal identity checks. A window title alone is not proof
  that a terminal belongs to Multi Codex.
- Preserve fail-closed probing and fail-open visibility: ambiguous sessions
  must not be changed, and a terminal actor must never remain transparent
  after an error.
- Keep panel placement event-driven. Do not add periodic polling or broad
  reparenting listeners.
- Use four-space indentation and semicolons in JavaScript.
- Use Bash for runtime scripts, quote expansions, and keep
  `set -uo pipefail`.
- Keep user-visible extension text in English.
- Add or update regression tests for every behaviour change.
- Run `make test`, `make package`, and `make smoke` before release.
