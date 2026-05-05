# Changelog

All notable changes to `@crucible/forge-cli` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
