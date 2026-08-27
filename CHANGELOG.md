# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* `overleaf_set_session`, which replaces an expired session with a fresh browser cookie from inside Claude, verified against Overleaf before it is saved
* `overleaf_check`, reporting dangling `ef`, undefined `\cite`, duplicate `\label` and uncited bibliography entries with the file and line of every occurrence
* `limit`, `offset`, `severity`, `kind` and `file` on `overleaf_compile_log`, so a log with hundreds of warnings can be paged and narrowed instead of cut off at 40
* Grouping of log entries by kind and by file before the entries themselves
* Page count on `overleaf_compile` and `overleaf_download_pdf`
* `outline` mode on `overleaf_read_file`, listing sections, labels, captions, floats and inputs with line numbers
* Compile result caching, with every result reporting whether it was recompiled or reused, and a `refresh` flag to force a new compile
* `npm test`, an offline check of the log parser, reference checker and outline builder
* `npm run feature-check`, which asserts the new behaviour end to end in a project it creates for the purpose

### Changed

* `overleaf_download_file` now fetches compilation artifacts such as `output.log`, `output.blg` and `output.chktex`, which are not part of the project file tree
* `overleaf_upload_file` documents that it takes text files as well as binaries, so large documents can be sent from disk instead of retyped as a tool argument
* `overleaf_read_file` returns a structure outline for a file too large to return whole, rather than a truncated prefix
* Expired session errors now name `overleaf_set_session` instead of a command the caller may not be able to run

### Fixed

* LaTeX log entries no longer report `(unknown location)`: TeX's 79 column wrapping is reversed, the `(file` and `)` markers are tracked as a stack, and `on input line N`, `at lines N--M`, `l.N` and `file:line:` are all read
* Overfull and underfull box warnings now carry their line range and overflow amount
* A session refreshed on disk is picked up by a running server instead of being masked by the in memory copy
## [0.2.0]

### Added

* Project selection that persists across restarts, so one choice applies to every later request
* Image reading, returning figures as viewable content rather than a file path
* Full write path: create, overwrite, upload, rename, move, delete, and folder creation
* History tools: recent versions with authors, read a file at a past version, diff two versions, and restore
* Overwrite guard that refuses a write when the file changed on Overleaf since it was last read
* `overleaf_status` for session health, expiry, and current selection
* `overleaf_project_url` for jumping to the project in a browser
* One command setup that can reuse an existing browser login instead of asking for a password
* `mcp-check`, which drives the built server as a real MCP client and asserts 19 behaviours
* `smoke`, which exercises the full write path in a throwaway project
* `recon`, a read only probe of every endpoint used

### Changed

* File tree now comes from the Overleaf socket connection, which is the only source carrying entity ids
* Search fetches documents directly for smaller projects instead of downloading the whole archive
* Large file reads truncate with paging instructions rather than flooding the conversation
* Missing paths suggest the closest real filenames instead of listing everything

### Fixed

* Login detection keyed on a meta tag present on the login page too, which caused anonymous sessions to be saved as if they were valid
* Browser session import reported success without verifying the session actually worked
* `.env` was documented but never loaded
* Setup could fail when the server was already registered with Claude Code

## [0.1.0]

### Added

* Initial MCP server with project listing, file listing, reading, search, and compile
* Browser based authentication with persisted session cookies
