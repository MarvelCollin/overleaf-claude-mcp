# Setting this up as an agent

You are Claude, or another coding agent, and someone asked you to set this up. Read this before running anything. The goal is to finish in one pass and interrupt the user at most once.

## The only thing you cannot do

Authentication needs an Overleaf session. You must never type or ask for the user's password, and you must never handle it. Everything else in this document you can do yourself without asking.

There are three ways to get a session. Pick the first one that applies. Do not ask the user which to use.

| Situation | Method | User involvement |
| --- | --- | --- |
| Machine has a display, browser signed in to Overleaf already | `npm run login:browser -- --real-profile` | Close their browser first |
| Machine has a display, not signed in anywhere | `npm run login` | They sign in, one time |
| No display, such as SSH, Docker, CI, a remote sandbox | `npm run login:paste` | They paste one cookie, one time |

Detect which case you are in before choosing. On Linux, no display means `DISPLAY` and `WAYLAND_DISPLAY` are both unset.

## One shot setup

Run this and nothing else. Do not narrate each step to the user.

```bash
npm run agent-setup
```

It installs, builds, verifies the server starts, obtains a session by whichever method fits the machine, reads one of the user's real projects to prove the connection, and registers the server with Claude Code at user scope. It is fully non interactive, so it will never hang waiting on a prompt.

Read the last two lines. They are the contract.

```
RESULT: READY | NEED_COOKIE | FAILED
NEXT_ACTION: <exactly what to do next>
```

| RESULT | Exit code | What you do |
| --- | --- | --- |
| `READY` | 0 | Tell the user to restart Claude. You are done. |
| `NEED_COOKIE` | 2 | Ask the user for the cookie once, then rerun with `OVERLEAF_SESSION_COOKIE` set |
| `FAILED` | 1 | Report the `[fail]` line to the user. Do not improvise a workaround. |

The `NEED_COOKIE` output contains the exact wording to use when asking. Use it verbatim, then:

```bash
OVERLEAF_SESSION_COOKIE="<what they pasted>" npm run agent-setup
```

That second run finishes everything. Two commands total, one question to the user, worst case.

Pass `--no-browser` if you want to skip the browser methods and go straight to asking for a cookie.

## When there is no display

This is the case that traps agents. `npm run login` opens a real browser window and will fail on a headless host. Do not try to work around it with `xvfb`, VNC, or X11 forwarding, and do not tell the user to install a browser. Use paste mode.

Ask the user once, with these exact instructions:

> Open https://www.overleaf.com/project in any browser where you are signed in. Press F12, open Application, expand Cookies, select the Overleaf origin, click the row named `overleaf_session2`, and copy the whole Value. It is long and starts with `s%3A`. Paste it here.

Then run, without echoing the value back to them:

```bash
OVERLEAF_SESSION_COOKIE="<what they pasted>" npm run login:paste
```

That verifies the cookie against Overleaf before saving. If it prints an HTTP 302 rejection, the cookie was truncated or expired; ask them to copy it again. Do not retry with the same value.

## Registering with the MCP client

```bash
claude mcp add overleaf -- node "$(pwd)/dist/index.js"
```

Check whether it is already registered first, because adding twice errors:

```bash
claude mcp get overleaf >/dev/null 2>&1 && echo ALREADY || echo NEEDS_ADDING
```

Tell the user to restart Claude afterwards. MCP servers are only picked up at startup, and forgetting this is the single most common reason someone reports that the tools are missing.

## Verifying, in increasing cost

```bash
node scripts/verify-startup.mjs   # no credentials, no network, always safe
npm run recon                     # read only, hits every endpoint, needs a session
npm run mcp-check                 # drives the server as a real MCP client, needs a session
npm run smoke                     # creates a throwaway project and writes to it
```

Run `verify-startup` freely. Run `smoke` only when the user asks or when you changed the write path, because it leaves a project named `claude-mcp-smoketest` in their account.

`npm run mcp-check` is hardcoded to a specific project name. Pass a different one as an argument if their account differs.

## Diagnosing a failure

Run `npm run recon` first. It probes every endpoint read only and reports which one broke, which is faster than reading code. If the user reports that a tool failed, ask them to run `overleaf_status` through Claude, which reports session validity, expiry, and current selection in one line.

Sessions last about five days. An expired session shows up as every tool returning a redirect to login. The fix is the same three methods above.

## Rules

* Never ask for, type, or store the user's password
* Never print, log, or echo a session cookie value, including into a shell history or a commit
* Do not commit `~/.overleaf-claude-mcp/session.json` or anything derived from it
* Run the commands yourself rather than handing the user a list to run
* Interrupt the user at most once, and only for the browser sign in or the cookie paste
* Do not use `npm run smoke` on a machine where the user has not agreed to a throwaway project being created
