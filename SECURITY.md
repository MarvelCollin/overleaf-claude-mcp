# Security Policy

## What this project holds

This server authenticates to Overleaf with a real browser session. That session is stored at `~/.overleaf-claude-mcp/session.json` and is equivalent to full access to the Overleaf account that created it.

Treat that file the way you would treat a password.

* It is listed in `.gitignore`. Never commit it.
* It is written with `0600` permissions on macOS and Linux. Windows ignores those bits, so on Windows it is only as private as your user profile folder.
* The server sends it to exactly one origin, the configured `OVERLEAF_BASE_URL`. It is never logged, never printed, and never included in error messages.
* Sessions expire after roughly five days. `overleaf_status` reports the remaining time.

If you believe a session file has leaked, sign out of all sessions from Overleaf account settings, then run setup again to create a fresh one.

## Scope

This project talks to internal Overleaf endpoints that are not a published API. It is intended for use against your own account. Do not use it to access accounts you do not own.

## Reporting a vulnerability

Open a private security advisory through the GitHub Security tab of this repository. Please do not open a public issue for anything that could expose a session or account.

Include the version or commit, your platform, and the smallest set of steps that reproduces the problem. Avoid pasting cookie values, tokens, or project identifiers into the report.
