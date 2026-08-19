# overleaf-claude-mcp

MCP server that gives Claude access to your Overleaf projects.

Overleaf has no public API on the free tier. The Git bridge and Dropbox sync are Premium features, so this server talks to the same internal HTTP endpoints the Overleaf web app uses, authenticated with a real browser session you create once.

## How auth works

`npm run login` opens a real Chrome window at the Overleaf login page. You sign in by hand, which handles CAPTCHA and 2FA. Once you reach your project list, the session cookies are written to `~/.overleaf-claude-mcp/session.json` with `0600` permissions.

That file is equivalent to full access to your Overleaf account. It is gitignored. Do not share it, and do not commit it.

The server refreshes cookies automatically as Overleaf rotates them. When the session finally expires, every tool returns an error telling you to run `npm run login` again.

## Setup

```bash
npm install
npm run login
npm run build
```

Register with Claude Code:

```bash
claude mcp add overleaf -- node C:/CoolYEAH/overleaf-claude-mcp/dist/index.js
```

Or add to your MCP config manually:

```json
{
  "mcpServers": {
    "overleaf": {
      "command": "node",
      "args": ["C:/CoolYEAH/overleaf-claude-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `overleaf_list_projects` | List projects on the account |
| `overleaf_list_files` | List files in a project |
| `overleaf_read_file` | Read one text file |
| `overleaf_grep` | Regex search across a project |
| `overleaf_refresh` | Force re-download of a project |
| `overleaf_compile` | Trigger a server-side compile |
| `overleaf_compile_log` | Compile and return parsed LaTeX errors and warnings |
| `overleaf_download_pdf` | Compile and save the PDF locally |

## Reading model

Reads go through the project archive at `/project/:id/download/zip`, cached under `~/.overleaf-claude-mcp/cache` for `OVERLEAF_CACHE_TTL_MS` (default 60s). One HTTP call covers the whole file tree, so listing, reading and grepping stay cheap. Pass `refresh: true` on any read tool to bypass the cache.

## Endpoint verification

The endpoints this server uses are internal and undocumented, so they are verified against a live account rather than assumed:

```bash
npm run recon
```

That writes `recon-output/report.json` plus the redacted HTML of the project list and project pages. CSRF tokens are stripped before anything is written to disk. `recon-output/` is gitignored.

## Status

Read, search and compile work. Writing files back to Overleaf is not implemented yet: uploads need the numeric folder id of the target directory, which the project archive does not carry. That id comes from the `joinProject` message on Overleaf's socket connection, which is the next piece of work.

## Configuration

Every setting is optional. See `.env.example`.

| Variable | Default |
| --- | --- |
| `OVERLEAF_BASE_URL` | `https://www.overleaf.com` |
| `OVERLEAF_HOME_DIR` | `~/.overleaf-claude-mcp` |
| `OVERLEAF_SESSION_FILE` | `$OVERLEAF_HOME_DIR/session.json` |
| `OVERLEAF_CACHE_DIR` | `$OVERLEAF_HOME_DIR/cache` |
| `OVERLEAF_CACHE_TTL_MS` | `60000` |
| `OVERLEAF_LOGIN_TIMEOUT_MS` | `600000` |

## Limits

Overleaf can change these endpoints at any time; nothing here is a supported API. Use it against your own account only.
