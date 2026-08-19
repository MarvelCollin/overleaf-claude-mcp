# overleaf-claude-mcp

Connect Claude to your Overleaf account. Claude can list your projects, pick one, read the LaTeX and the figures, edit files, compile, and pull the PDF back.

Overleaf has no public API on the free tier: the Git bridge and Dropbox sync are Premium features. So this server speaks the same internal HTTP and socket endpoints the Overleaf web app uses, authenticated with a browser session you create once. Every endpoint was read out of Overleaf's own JavaScript bundle and then exercised against a live account. See [Verified endpoints](#verified-endpoints).

---

## Tutorial

### What you need

- Node 20 or newer (`node -v`)
- Chrome or Edge installed
- An Overleaf account, free tier is fine
- Claude Code (`claude --version`) or Claude Desktop

### Step 1: Run setup

From this folder, on Windows:

```bash
setup.cmd
```

On macOS or Linux:

```bash
./setup.sh
```

Setup runs five steps and prints each one:

1. Installs dependencies
2. Builds to `dist/`
3. Checks for a working Overleaf session. If there isn't one, a browser window opens on the Overleaf login page
4. Reads one of your real projects back, to prove the connection works
5. Offers to register the server with Claude Code

### Step 2: Get a session

Setup offers two ways.

**Reuse the login you already have.** If you are already signed in to Overleaf in Brave, Chrome or Edge, setup can lift that session, no typing at all. That browser must be **fully closed** first, because it holds its cookie database open and it has to decrypt its own cookies. Setup launches it against its own profile, reads the Overleaf cookies, and closes it again.

**Or sign in fresh.** Say no to the reuse prompt and a clean browser window opens on the Overleaf login page. Sign in the way you normally would, including 2FA. Nothing types your password for you and your password is never read or stored.

Either way, once the session is confirmed against `/project`, the cookies are saved to `~/.overleaf-claude-mcp/session.json`. A session lasts about five days; `overleaf_status` tells you how long is left.

That file is equivalent to full access to your Overleaf account. It is gitignored, and written with `0600` permissions on macOS and Linux. On Windows those permission bits are ignored, so the file is only as private as your user profile folder. Do not share it and do not commit it.

### Step 3: Let setup register the server

At step 5 you get a prompt:

```
      Register this server with Claude Code now? [y/N]
```

Answer `y`. That runs:

```bash
claude mcp add overleaf -- node C:/CoolYEAH/overleaf-claude-mcp/dist/index.js
```

If you skipped it, or you use a different client, register by hand. For **Claude Code**, run the command above. For **Claude Desktop**, edit `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

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

### Step 4: Restart Claude

MCP servers are only picked up at startup. Quit and reopen Claude Code or Claude Desktop.

Confirm it loaded:

```bash
claude mcp list
```

You should see `overleaf` listed as connected. Inside a Claude Code session, `/mcp` shows the same thing.

### Step 5: Use it

Just ask in plain language. Claude picks the tools itself.

```
List my Overleaf projects
```
```
Select the Efficient Reasoning project
```
```
Read sections/methodology.tex
```
```
In sections/results.tex, change "Table 1" to "Table~\ref{tab:main}"
```
```
Compile it and tell me what the LaTeX errors are
```
```
Show me figures/fig1.png
```
```
Save the compiled PDF to C:/tmp/paper.pdf
```

Pick a project once and it sticks. The selection is stored in `~/.overleaf-claude-mcp/state.json` and survives restarts, so every later request applies to that project until you switch. To work on a different project in one request without switching, name it: "read main.tex from my thesis project".

---

## How to trigger it

There is no slash command and nothing to type. Claude reads the tool descriptions and calls them when your request matches. Mentioning Overleaf, or a project or file you already selected, is enough.

If Claude does not reach for the tools, the usual causes are: you did not restart after registering, or no project is selected yet. Ask "what Overleaf project is selected?" to check.

### Tools

| Tool | Purpose |
| --- | --- |
| `overleaf_status` | Session health, expiry, and current selection |
| `overleaf_project_url` | Browser URL for the selected project |
| `overleaf_list_projects` | List projects, marking the selected one |
| `overleaf_select_project` | Pick the active project by id or name |
| `overleaf_current_project` | Show which project is selected |
| `overleaf_list_files` | Full file and folder tree |
| `overleaf_read_file` | Read a text file, with `startLine` and `endLine` paging |
| `overleaf_read_image` | View a figure inline |
| `overleaf_download_file` | Save any file, including PDFs, locally |
| `overleaf_grep` | Regex search across the project |
| `overleaf_write_file` | Create or overwrite a text file |
| `overleaf_edit_file` | Exact string replacement inside a file |
| `overleaf_upload_file` | Upload a local file such as a figure |
| `overleaf_create_folder` | Create a folder and any missing parents |
| `overleaf_rename` | Rename a file or folder |
| `overleaf_move` | Move a file or folder |
| `overleaf_delete` | Delete an entry, requires `confirm: true` |
| `overleaf_compile` | Server side compile |
| `overleaf_compile_log` | Compile and return parsed LaTeX errors |
| `overleaf_download_pdf` | Compile and save the PDF |
| `overleaf_word_count` | Compiled word count |

`overleaf_select_project` takes a project id or any part of a project name. If the name matches more than one project it lists the candidates instead of guessing. `overleaf_delete` refuses to run unless `confirm` is true, so Claude cannot delete a file by accident.

---

## Troubleshooting

**Anything failing at all** — ask Claude for `overleaf_status` first. It reports whether the session is alive, when it expires, and what is selected, which usually identifies the problem immediately.

**"No Overleaf session at ..."** — you have not signed in yet, or the session expired. Run `setup.cmd` again.

**Session reuse says your browser is not signed in** — the browser was still running, so its cookie database was locked and could not be read. Close it completely, including any tray icon or "keep running in background" instance, then retry.

**Claude does not see the tools** — you did not restart Claude after registering. Check `claude mcp list`.

**A tool suddenly fails** — Overleaf may have changed an endpoint. Run `npm run recon`, which probes each endpoint read-only and tells you exactly which call broke.

**Check your setup from the terminal, without Claude:**

```bash
npm run read -- "Efficient Reasoning"
```

Prints the file tree and every section heading of the matching project. Add a path to dump a single file:

```bash
npm run read -- "Efficient Reasoning" sections/methodology.tex
```

**Re-run setup any time.** It reuses a working session and re-verifies the connection, so it doubles as a health check.

---

## How it works

The file tree comes from Overleaf's socket connection, because that is the only source that carries entity ids, and ids are what writes need. The handshake is `GET /socket.io/1/?projectId=<id>`, which is socket.io 0.9 framing; the server then pushes `joinProjectResponse` with the whole project including `rootFolder`, doc ids and file hashes. The tree is cached for `OVERLEAF_TREE_TTL_MS` (default 15s) and invalidated after every write.

Text files are read per document, so a read always reflects the current state. `overleaf_grep` fetches the documents directly for projects up to `OVERLEAF_DOC_GREP_LIMIT` docs, which avoids downloading the PDFs and figures that a project archive would drag along; past that limit it falls back to one archive download.

`overleaf_read_file` truncates at `OVERLEAF_MAX_READ_CHARS` and tells you how to page through the rest, so asking for a 280,000 character class file does not flood the conversation. Asking for a path that does not exist suggests the closest real ones rather than dumping the whole file list.

Writes go through the upload endpoint. Uploading over an existing name is an in place update: the entity id is preserved, so Overleaf history and anyone else in the document keep working. Missing parent folders are created first.

## Verified endpoints

Confirmed live against a real account, not assumed:

| Operation | Call | Notes |
| --- | --- | --- |
| Project list | `GET /project` | `ol-prefetchedProjectsBlob` meta tag |
| CSRF | `GET /project` | `ol-csrfToken` meta tag, resent as `x-csrf-token` |
| New project | `POST /project/new` | returns `project_id` |
| File tree | `GET /socket.io/1/?projectId=` then websocket | `joinProjectResponse` |
| Paths only | `GET /project/:id/entities` | cheap, no ids |
| Read doc | `GET /project/:id/doc/:docId/download` | plain text |
| Read binary | `GET /project/:id/blob/:hash` | hash comes from the tree |
| Archive | `GET /project/:id/download/zip` | used for grep |
| Create or overwrite | `POST /project/:id/upload?folder_id=` | multipart, field `qqfile` |
| Create doc or folder | `POST /project/:id/doc`, `POST /project/:id/folder` | body `{name, parent_folder_id}` |
| Rename | `POST /project/:id/:type/:entityId/rename` | 204 |
| Move | `POST /project/:id/:type/:entityId/move` | 204, body `{folder_id}` |
| Delete | `DELETE /project/:id/:type/:entityId` | 204 |
| Compile | `POST /project/:id/compile` | returns `outputFiles` and `clsiServerId` |
| Word count | `GET /project/:id/wordcount` | |

`:type` is `doc`, `file` or `folder`.

## Scripts

| Command | What it does |
| --- | --- |
| `setup.cmd` / `./setup.sh` | Full setup from scratch |
| `npm run setup` | Same, assuming dependencies are installed |
| `npm run login` | Sign in fresh in a clean browser window |
| `npm run login:browser -- --real-profile` | Reuse the session from your everyday browser, which must be closed |
| `npm run mcp-check` | Drive the built server as a real MCP client and assert 16 behaviours |
| `npm run read -- "<project>"` | Inspect a project from the terminal |
| `npm run recon` | Read-only probe of every endpoint |
| `npm run smoke` | End-to-end write test in a throwaway project |
| `npm run build` | Compile to `dist/` |

`npm run smoke` creates a project called `claude-mcp-smoketest`, then exercises write, overwrite, image upload, rename, move, delete and compile. It leaves the project in your account so you can inspect it. Trash it when you are done.

## Configuration

All optional. Copy `.env.example` to `.env` in this folder and it is loaded on startup.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OVERLEAF_BASE_URL` | `https://www.overleaf.com` | Point at a self-hosted instance |
| `OVERLEAF_HOME_DIR` | `~/.overleaf-claude-mcp` | Where the session and selection live |
| `OVERLEAF_SESSION_FILE` | `$OVERLEAF_HOME_DIR/session.json` | |
| `OVERLEAF_MAX_READ_CHARS` | `60000` | Truncation point for `overleaf_read_file` |
| `OVERLEAF_DOC_GREP_LIMIT` | `40` | Above this many docs, grep uses the archive |
| `OVERLEAF_TREE_TTL_MS` | `15000` | File tree cache lifetime |
| `OVERLEAF_SOCKET_TIMEOUT_MS` | `20000` | |
| `OVERLEAF_LOGIN_TIMEOUT_MS` | `600000` | How long the login window waits |

## Limits

None of this is a supported API, and Overleaf can change it at any time. Use it against your own account. Real time collaborative editing is not implemented: writes replace a whole document rather than sending character level operations, so avoid writing to a file while someone else is typing in it.
