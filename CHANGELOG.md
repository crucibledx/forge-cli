# Changelog

All notable changes to `@crucible/forge-cli` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.2] — 2026-05-05

### Changed
- **`forge init` no longer overwrites existing config** — if `.crucible/forge.config.yaml` is found, the wizard aborts with a message pointing to `forge config` (coming in v0.2)
- Removed the "Overwrite existing config?" confirm prompt entirely
- Updated unit and e2e tests: removed overwrite tests, added abort-on-existing tests

---

## [0.1.1] — 2026-05-05

### Added
- **Local source type** — `forge init` now supports `type: local` sources (reads from a local directory, no network required)
- **Source-type select in init wizard** — instead of jumping straight to git URL, users now pick a source type first (`Git (SSH / HTTPS)` or `Local directory`)
- `getSourceLoaderOptions()` helper on the source barrel — populates the select from the loader registry; adding a new source type requires no handler changes
- `label` field on `SourceLoaderEntry` for display in the select prompt
- Unit tests for `localLoader` and `getSourceLoaderOptions`

---

## [0.1.0] — 2026-05-05

### Added
- `forge init` wizard — scans for existing AI configs, prompts per-assistant, writes `.crucible/forge.config.yaml`
- `forge sync` — pulls from a single git source, places files into correct assistant paths
- `forge sync --dry-run` — previews what would change without writing
- Auto-target resolution for Claude Code, Cursor, Windsurf, Copilot, Cline
- File transforms: `.md → .mdc` (Cursor), `.md → .instructions.md` (Copilot)
- SHA-based file change detection (no unnecessary rewrites)
- Git source support (SSH + HTTPS), shallow clone with temp-dir caching
- Global + project config merge (`~/.crucible/forge.config.yaml` + `.crucible/forge.config.yaml`)
- Single binary build via `bun build --compile`
- Full unit + e2e test suite (Bun test runner + PTY-based e2e)
