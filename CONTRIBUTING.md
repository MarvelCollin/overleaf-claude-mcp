# Contributing

## Getting set up

```bash
npm install
npm run setup
```

Setup builds the project, gets you an Overleaf session, and verifies the connection against a real project.

## Before you open a pull request

```bash
npm run build
npm run mcp-check
```

`mcp-check` spawns the built server and drives it as a real MCP client over stdio, asserting 19 behaviours against a live account. It is currently hardcoded to a specific project name and file paths, so adjust the constants at the top if your account differs.

For changes that touch writing, renaming, moving, deleting, or compiling, also run:

```bash
npm run smoke
```

That creates a throwaway project named `claude-mcp-smoketest`, exercises the full write path in it, and leaves it in your account for inspection. Trash it afterwards.

## Working on the Overleaf integration

None of the endpoints this project uses are a published API. They were read out of Overleaf's own JavaScript bundle and then verified live. The table in the README lists every one.

If something breaks, run `npm run recon` first. It probes each endpoint read only and reports exactly which call changed shape, which is almost always faster than reading code.

When you add an endpoint, verify it against a live account before relying on it, and add it to the README table.

## Style

* TypeScript, strict mode, no comments in source
* Match the surrounding code rather than introducing new patterns
* Errors should say what to do next, not just what failed

## Commits

Conventional Commits, subject line only, no body.

```
feat: add project history and version restore tools
fix: refuse writes when a file changed since it was read
docs: document the overwrite guard
```

## Safety expectations

Anything destructive stays behind an explicit flag. `overleaf_delete` and `overleaf_restore_file` both require `confirm`, and whole document writes are guarded against clobbering concurrent edits. Keep it that way.
