# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
