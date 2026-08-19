# overleaf-claude-mcp

MCP server that connects Claude to your Overleaf account. List and pick a project, read the LaTeX and the figures, edit files, compile, and pull the PDF back.

Overleaf has no public API on the free tier: the Git bridge and Dropbox sync are Premium features. So this server speaks the same internal HTTP and socket endpoints the Overleaf web app itself uses, authenticated with a browser session you create once.

Every endpoint used here was read out of Overleaf's own JavaScript bundle and then exercised against a live account. See [Verified endpoints](#verified-endpoints).

## How auth works

`npm run login` opens a real Chrome window on the Overleaf login page. You sign in by hand, so CAPTCHA and 2FA work normally. Once you land on your project list, the session cookies are written to `~/.overleaf-claude-mcp/session.json` with `0600` permissions.

That file is equivalent to full access to your Overleaf account. It is gitignored. Do not share it and do not commit it.

Cookies are refreshed automatically as Overleaf rotates them. When the session finally expires, every tool returns an error telling you to run `npm run login` again.

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

Or add it to an MCP config file:

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

## Usage

Pick a project once, then every other tool defaults to it. The selection persists across restarts in `~/.overleaf-claude-mcp/state.json`.

```
overleaf_list_projects
overleaf_select_project { "query": "Efficient Reasoning" }
overleaf_read_file { "filePath": "sections/methodology.tex" }
overleaf_edit_file { "filePath": "sections/methodology.tex", "oldString": "Table 1", "newString": "Table~\\ref{tab:main}" }
overleaf_compile_log
```

`overleaf_select_project` takes a project id or any part of a project name. If the name matches more than one project it lists the candidates instead of guessing.

## Tools

| Tool | Purpose |
| --- | --- |
| `overleaf_list_projects` | List projects, marking the selected one |
| `overleaf_select_project` | Pick the active project by id or name |
| `overleaf_current_project` | Show which project is selected |
| `overleaf_list_files` | Full file and folder tree |
| `overleaf_read_file` | Read a LaTeX or other text file |
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

## How it works

The file tree comes from Overleaf's socket connection, because that is the only source that carries entity ids, and ids are what writes need. The handshake is `GET /socket.io/1/?projectId=<id>`, which is socket.io 0.9 framing; the server then pushes `joinProjectResponse` with the whole project including `rootFolder`, doc ids and file hashes. The tree is cached for `OVERLEAF_TREE_TTL_MS` (default 15s) and invalidated after every write.

Text files are read per document, so a read always reflects the current state. `overleaf_grep` reads the project archive instead, so a whole project search costs one request rather than one per file.

Writes go through the upload endpoint. Uploading over an existing name is an in place update: the entity id is preserved, so Overleaf history and any collaborators in the document keep working. Missing parent folders are created first.

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

## Checking it still works

```bash
npm run recon
```

Read only. Probes every endpoint against your first project and writes `recon-output/report.json`. Run this first if something starts failing; it tells you which call broke.

```bash
npm run smoke
```

Creates a throwaway project called `claude-mcp-smoketest`, then exercises write, overwrite, image upload, rename, move, delete and compile end to end. It leaves the project in your account so you can inspect it. Trash it when you are done.

## Configuration

All optional. See `.env.example`.

| Variable | Default |
| --- | --- |
| `OVERLEAF_BASE_URL` | `https://www.overleaf.com` |
| `OVERLEAF_HOME_DIR` | `~/.overleaf-claude-mcp` |
| `OVERLEAF_SESSION_FILE` | `$OVERLEAF_HOME_DIR/session.json` |
| `OVERLEAF_CACHE_DIR` | `$OVERLEAF_HOME_DIR/cache` |
| `OVERLEAF_TREE_TTL_MS` | `15000` |
| `OVERLEAF_SOCKET_TIMEOUT_MS` | `20000` |
| `OVERLEAF_LOGIN_TIMEOUT_MS` | `600000` |

## Limits

None of this is a supported API, and Overleaf can change it at any time. Use it against your own account. Real time collaborative editing is not implemented: writes replace a whole document rather than sending character level operations, so avoid writing to a file while someone else is typing in it.
