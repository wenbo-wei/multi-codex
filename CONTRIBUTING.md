# Contributing

Keep Multi Codex independent of dashboard or AppIndicator extensions and keep
runtime paths relative to the installed extension. Do not add personal home
paths, session data, or commands that start or control Codex itself.

Before submitting a change, run:

```sh
make check
make verify
```

Describe any manual GNOME Shell 50 and Ptyxis checks separately from automated
checks. A successful package or settings write is not proof that a visible
Shell button loaded.
