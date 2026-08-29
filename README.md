# overleaf-claude-mcp

[![CI](https://github.com/MarvelCollin/overleaf-claude-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/MarvelCollin/overleaf-claude-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/Model%20Context%20Protocol-server-8A2BE2.svg)](https://modelcontextprotocol.io)

Connect Claude to your Overleaf account. Claude can list your projects, pick one, read the LaTeX and the figures, edit files, compile, and pull the PDF back. It can also run your writing through free AI content detectors and check it for plagiarism, and tell you which sentence, in which file, on which line, was flagged.

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

> **Want Claude to set this up for you?** Tell it: *"set up overleaf-claude-mcp, read AGENTS.md first"*. It runs `npm run agent-setup`, which handles everything non interactively and asks you at most one question. [AGENTS.md](AGENTS.md) covers every case including headless servers.

### Step 2: Get a session

Setup offers three ways, and picks based on your machine.

**No graphical display**, such as SSH, Docker, a remote sandbox or CI? Setup detects that and asks you to paste a cookie instead of trying to open a window:

```bash
OVERLEAF_SESSION_COOKIE="paste_the_value_here" npm run login:paste
```

Get the value from any browser where you are already signed in: open `https://www.overleaf.com/project`, press F12, go to Application, expand Cookies, select the Overleaf origin, and copy the whole Value of `overleaf_session2`. It is long and starts with `s%3A`. The cookie is verified against Overleaf before anything is saved.

Otherwise setup offers two browser based options.

**Reuse the login you already have.** If you are already signed in to Overleaf in Brave, Chrome, Chromium or Edge, setup can lift that session, no typing at all. That browser must be **fully closed** first, because it holds its cookie database open and it has to decrypt its own cookies. Setup launches it against its own profile, reads the Overleaf cookies, and closes it again.

**Or sign in fresh.** Say no to the reuse prompt and your default browser opens on the Overleaf login page. Sign in the way you normally would, including 2FA. Nothing types your password for you and your password is never read or stored.

Either way, once the session is confirmed against `/project`, the cookies are saved to `~/.overleaf-claude-mcp/session.json`. A session lasts about five days; `overleaf_status` tells you how long is left.

That file is equivalent to full access to your Overleaf account. It is gitignored, and written with `0600` permissions on macOS and Linux. On Windows those permission bits are ignored, so the file is only as private as your user profile folder. Do not share it and do not commit it.

### Setting up over SSH, with no browser on the server

You do not log in on the server. There is nothing to install there and no browser to open. You borrow the login you already have on your own machine.

On your laptop, in a browser already signed in to Overleaf:

1. Open `https://www.overleaf.com/project`
2. Press F12
3. Application on Chrome, Brave and Edge, or Storage on Firefox
4. Expand Cookies, select the Overleaf origin
5. Click the row named `overleaf_session2` and copy the whole Value

In your SSH session:

```bash
npm run login:paste
```

It prompts, you paste, it checks the cookie against Overleaf and saves it. That is the entire process.

If you are running it non interactively, pass the value as an environment variable instead:

```bash
OVERLEAF_SESSION_COOKIE="s%3A...." npm run login:paste
```

The cookie is verified before anything is written, so a truncated or expired paste fails immediately with a clear message rather than half working later. It is never printed back to you or written to logs. Sessions last about five days; repeat this when it lapses.

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
| `overleaf_set_session` | Replace an expired session with a fresh browser cookie |
| `overleaf_project_url` | Browser URL for the selected project |
| `overleaf_list_projects` | List projects, marking the selected one |
| `overleaf_select_project` | Pick the active project by id or name |
| `overleaf_current_project` | Show which project is selected |
| `overleaf_list_files` | Full file and folder tree |
| `overleaf_read_file` | Read a text file, with `startLine`/`endLine` paging and an `outline` mode |
| `overleaf_read_image` | View a figure inline |
| `overleaf_download_file` | Save any file locally, including compilation artifacts such as `output.log` |
| `overleaf_grep` | Regex search across the project |
| `overleaf_write_file` | Create or overwrite a text file |
| `overleaf_edit_file` | Exact string replacement inside a file |
| `overleaf_upload_file` | Upload any local file, text or binary, straight from disk |
| `overleaf_create_folder` | Create a folder and any missing parents |
| `overleaf_rename` | Rename a file or folder |
| `overleaf_move` | Move a file or folder |
| `overleaf_delete` | Delete an entry, requires `confirm: true` |
| `overleaf_history` | Recent versions: who changed what, and when |
| `overleaf_file_at_version` | Read a file as it was at a past version |
| `overleaf_diff` | What changed in a file between two versions |
| `overleaf_restore_file` | Roll a file back, requires `confirm: true` |
| `overleaf_compile` | Server side compile, with page count and output artifacts |
| `overleaf_compile_log` | Parsed LaTeX errors and warnings with `file:line`, filtering and paging |
| `overleaf_check` | Dangling `\ref`, undefined `\cite`, duplicate labels, uncited entries |
| `overleaf_download_pdf` | Compile and save the PDF |
| `overleaf_word_count` | Compiled word count |
| `overleaf_ai_detect` | Score prose with free AI detectors and list the sentences each one flagged |
| `overleaf_plagiarism_check` | Find sentences that already exist word for word on the web, with the source URL |
| `overleaf_detectors` | Which detectors are ready and what each one needs |

`overleaf_select_project` takes a project id or any part of a project name. If the name matches more than one project it lists the candidates instead of guessing. `overleaf_delete` refuses to run unless `confirm` is true, so Claude cannot delete a file by accident.

#### Edits are checked for silent damage

`overleaf_write_file` and `overleaf_edit_file` compare the file before and after every write and report anything that changed beyond wording: a number that moved or vanished, a dropped `\cite`, `ef` or `\label`, an unbalanced `egin`. Rewording a paragraph passes silently. Losing a figure from a table, or a citation from a sentence, comes back as a warning on the tool result, so a prose edit cannot quietly corrupt a manuscript.

### Checking for AI detection and plagiarism

Ask in plain words: *"check my introduction for AI detection"*, *"run the whole paper through a plagiarism check"*, or paste a paragraph and ask *"would this get flagged as AI?"*

Both checks accept the same three inputs: `text` for a pasted passage, `filePath` for one file in the selected project, or `wholeProject` for every `.tex` file at once.

LaTeX is stripped before anything is sent. The preamble, math environments, figures, tables, listings, `\cite`, `
ef` and `\label` are all removed, so the detectors score your prose rather than your markup. Every flagged sentence is then mapped back to the file and line it came from, so you can go straight to it and rewrite it.

```
main.tex, 1204 words, 7810 chars
consensus: 71.5% AI, likely AI, across 2 detector(s)

ZeroGPT    88.0%  Your Text is AI/GPT Generated
Decopy     55.0%  Decopy rates this as mostly AI generated

flagged by more than one detector (2):
  main.tex:112  Furthermore, mitochondria play a crucial role in regulating cellular metabolism...
  main.tex:118  Consequently, it is imperative to acknowledge that the systematic optimisation...
```

#### How each check works

The AI detectors are the free public ones, and no API key is needed for the defaults:

| Provider | How it is reached | Notes |
| --- | --- | --- |
| ZeroGPT | Direct HTTP, the endpoint its own site calls | No key, no quota seen, returns the flagged sentences |
| Decopy | Playwright drives the real page and the JSON its site fetches is read back | No key, but the anonymous quota runs out after a few checks and resets later |
| Sapling | Direct HTTP | Only runs if `SAPLING_API_KEY` is set |
| GPTZero | Direct HTTP | Only runs if `GPTZERO_API_KEY` is set |

Providers that need a key are skipped silently unless you set one, so out of the box you get ZeroGPT and Decopy. Run `overleaf_detectors` to see the current state. Text longer than a provider's limit is split at paragraph boundaries and the scores are averaged by length.

The plagiarism check does not use a plagiarism site. The free ones tested here reported verbatim Wikipedia text as original, so instead each long sentence is searched on the web as an exact phrase, and **every candidate page is then fetched and read** to confirm the wording really appears on it. A sentence is only reported when at least eight consecutive words are found on the page, which is what keeps unrelated search results out of the report. Twelve sentences are sampled evenly across the text by default; raise it with `maxQueries`.

```
main.tex, checked by web search, confirmed on the source page
12 passage(s) searched, 1 found verbatim on the web
8.3% of searched passages matched a source, 91.7% appear original

main.tex:5  Mitochondria have a double membrane structure and use aerobic respiration to generate...
  Mitochondria - Wikipedia
  https://en.wikipedia.org/wiki/Mitochondria
```

A score is evidence, not a verdict. Detectors disagree with each other and all of them flag formal academic prose written by hand, so treat a high number as a prompt to reread the sentence, not as proof of anything.

#### Refreshing an expired session without leaving Claude

A session lasts about five days. When it expires, paste a fresh `overleaf_session2` value and ask Claude to call `overleaf_set_session`. The cookie is verified against Overleaf before it replaces the stored one, the running server picks it up immediately, and nothing has to be restarted or edited by hand.

#### Reading a large compile log

`overleaf_compile_log` parses the log rather than truncating it. Every entry carries the file and line it came from, including the line range of an overfull box, and entries are tallied by kind and by file first so a paper with hundreds of benign warnings does not bury the three that matter:

```
0 error(s), 251 warning(s) in the whole log

by kind:
   187  overfull-hbox
    61  package-warning
     3  undefined-reference

by file:
   201  sections/results.tex
    50  main.tex

showing 1-40 of 251 matching entr(ies)
- sections/results.tex:412-414  Overfull \hbox (36.51074pt too wide) in paragraph at lines 412--414
...
40 more. Pass offset 40.
```

Narrow it with `severity`, `kind` and `file`, and page through it with `limit` and `offset`. `overleaf_check` answers the reference questions directly, so you do not have to mine the log for them.

#### Uploading large content

`overleaf_upload_file` takes a `localPath` and works for text as well as binaries. Prefer it over `overleaf_write_file` whenever the content is already on disk: a 120 KB `results.tex` is sent straight from the file instead of being retyped as a tool argument.

---

## Troubleshooting

**Anything failing at all** — ask Claude for `overleaf_status` first. It reports whether the session is alive, when it expires, and what is selected, which usually identifies the problem immediately.

**"No Overleaf session at ..."** — you have not signed in yet, or the session expired. Fastest fix from inside Claude: copy a fresh `overleaf_session2` cookie and ask Claude to call `overleaf_set_session` with it. Otherwise run `setup.cmd` again.

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

`overleaf_read_file` stops at `OVERLEAF_MAX_READ_CHARS`. Rather than dumping a prefix, it returns a structure outline of the file, listing every `\section`, `\label`, `\caption`, float and `\input` with its line number, which is usually what a large file was being opened for; `startLine` and `endLine` then fetch the part you want. Pass `outline: true` to get that outline for a file of any size. Asking for a path that does not exist suggests the closest real ones rather than dumping the whole file list.

Compiles are cached for `OVERLEAF_COMPILE_TTL_MS` (default 120s) and invalidated by every write, so reading the log, downloading the PDF and running `overleaf_check` in a row costs one compile rather than three. Every result says whether it was recompiled or reused, and `refresh` forces a new compile. Compilation artifacts are not part of the project file tree, so `overleaf_download_file` recognises `output.log`, `output.blg`, `output.chktex` and the rest and fetches them from the compile output instead.

The log parser reverses TeX's 79 column line wrapping before it reads anything, tracks the `(file` and `)` markers as a stack so every message is attributed to the file that was open, and reads the line numbers TeX actually prints: `on input line N` for warnings, `at lines N--M` for boxes, `l.N` for errors, and the `file:line:` prefix when `-file-line-error` is on.

Writes go through the upload endpoint. Uploading over an existing name is an in place update: the entity id is preserved, so Overleaf history and anyone else in the document keep working. Missing parent folders are created first.

Because a write replaces a whole document, there is a guard against clobbering someone else's work. The server remembers a hash of every file it reads. If you then write to that file and Overleaf's copy no longer matches what was read, the write is refused:

> "sections/results.tex" changed on Overleaf since you last read it, so writing now would discard those edits.

Read the file again to pick up the change, or pass `force` to overwrite deliberately. If something does get overwritten, `overleaf_history` shows the versions and `overleaf_restore_file` rolls it back.

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
| History | `GET /project/:id/updates?min_count=` | version ranges, authors, changed paths |
| Version content | `GET /project/:id/diff?pathname=&from=V&to=V` | equal from and to returns the whole file |
| Diff | `GET /project/:id/diff?pathname=&from=&to=` | segments keyed `u`, `i`, `d` |

`:type` is `doc`, `file` or `folder`.

## Scripts

| Command | What it does |
| --- | --- |
| `setup.cmd` / `./setup.sh` | Full setup from scratch |
| `npm run setup` | Same, assuming dependencies are installed |
| `npm run agent-setup` | Non interactive setup for agents, prints `RESULT` and `NEXT_ACTION` |
| `npm run login` | Sign in fresh, using your default browser |
| `npm run login:paste` | Paste a session cookie, for machines with no display |
| `npm run login:browser -- --real-profile` | Reuse the session from your everyday browser, which must be closed |
| `npm run mcp-check` | Drive the built server as a real MCP client and assert 19 behaviours |
| `npm run read -- "<project>"` | Inspect a project from the terminal |
| `npm run recon` | Read-only probe of every endpoint |
| `npm run smoke` | End-to-end write test in a throwaway project |
| `npm run build` | Compile to `dist/` |
| `npm test` | Offline parser and detector assertions, no network, no credentials |
| `npm run detect -- <file or text>` | Run the AI detectors from the terminal |
| `npm run detect -- <file> --plagiarism` | Run the plagiarism check from the terminal |
| `npm run detect-live` | Hit the real detectors and assert a known AI sample scores high and a human one low |
| `npm run detect:setup` | Install the Chromium build Playwright drives |

`npm run smoke` creates a project called `claude-mcp-smoketest`, then exercises write, overwrite, image upload, rename, move, delete and compile. It leaves the project in your account so you can inspect it. Trash it when you are done.

## Configuration

All optional. Copy `.env.example` to `.env` in this folder and it is loaded on startup.

| Variable | Default | Meaning |
| --- | --- | --- |
| `OVERLEAF_BASE_URL` | `https://www.overleaf.com` | Point at a self-hosted instance |
| `OVERLEAF_HOME_DIR` | `~/.overleaf-claude-mcp` | Where the session and selection live |
| `OVERLEAF_SESSION_FILE` | `$OVERLEAF_HOME_DIR/session.json` | |
| `OVERLEAF_MAX_READ_CHARS` | `60000` | Point at which `overleaf_read_file` returns an outline instead |
| `OVERLEAF_COMPILE_TTL_MS` | `120000` | How long a compile result is reused before recompiling |
| `OVERLEAF_DOC_GREP_LIMIT` | `40` | Above this many docs, grep uses the archive |
| `OVERLEAF_TREE_TTL_MS` | `15000` | File tree cache lifetime |
| `OVERLEAF_SOCKET_TIMEOUT_MS` | `20000` | |
| `OVERLEAF_LOGIN_TIMEOUT_MS` | `600000` | How long the login window waits |
| `OVERLEAF_DETECT_TIMEOUT_MS` | `90000` | How long one detector or page is given to answer |
| `OVERLEAF_DETECT_MIN_CHARS` | `200` | Least prose a check will accept |
| `OVERLEAF_DETECT_BROWSER` | `chromium` | Playwright engine: `chromium`, `firefox` or `webkit` |
| `OVERLEAF_DETECT_HEADLESS` | `true` | Set `false` to watch the detector pages being driven |
| `SAPLING_API_KEY` | unset | Enables the Sapling detector |
| `GPTZERO_API_KEY` | unset | Enables the GPTZero detector |

## Project

* [Changelog](CHANGELOG.md)
* [Contributing](CONTRIBUTING.md)
* [Security policy](SECURITY.md)
* [MIT licensed](LICENSE)

## Limits

None of this is a supported API, and Overleaf can change it at any time. Use it against your own account. Real time collaborative editing is not implemented: writes replace a whole document rather than sending character level operations, so avoid writing to a file while someone else is typing in it.
