# Changelog

All notable changes to `@crucible/forge-cli` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.5] — 2026-05-06

### Changed

- **Global assistant detection** — `scanForAssistants` now checks `~/`-prefixed paths against HOME in addition to project paths. Each assistant definition includes global dirs/files sourced from research.
- **Scope-aware hint in multiselect** — detected assistants now show `"detected"` (project) or `"detected globally"` depending on where they were found. Project scope wins if both match.
- Updated detection paths per research, removing overly generic signals:
  - Claude Code: adds `~/.claude/` global dir; removes redundant sub-dirs
  - Cursor: adds `.cursorrules` (legacy) + `~/.cursor/mcp.json` (global, user-configured MCP)
  - Windsurf: adds `~/.codeium/windsurf/` global dir; removes redundant sub-dirs
  - Copilot: replaces generic `.github/` dir with `.github/instructions/` + adds `~/.copilot/`; `AGENTS.md` excluded (too generic — all tools support it)
  - Cline: adds `~/.cline/` global dir
- `scanForAssistants` is now synchronous (was `async Promise<>`)
- `DetectionResult` gains `scope?: 'project' | 'global'`
- e2e tests set `HOME=cwd` for the spawned process to isolate from real user global configs
- 5 new scanner unit tests covering global path resolution, scope field, and project-wins-over-global precedence

---

## [0.1.4] — 2026-05-06

### Changed

- **`SourceLoaderEntry` gains `configure()` method** — each source loader now owns its own wizard prompts. Adding a new source type requires only creating a new file in `infrastructure/source/<type>/` with `alias`, `label`, `configure`, and `load`. No changes to `init` handler or any command.
- **`init` handler is now source-type agnostic** — replaced `sourceConfigurators` map with a single `getSourceLoader(type).configure()` call. The handler has zero knowledge of git/local prompt details.
- Each source dir split into focused files: `messages.ts` (prompt strings), `loader.ts` (implementation), `index.ts` (barrel)
- `GIT_SOURCE_MESSAGES` exported from `infrastructure/source/git/messages.ts`
- `LOCAL_SOURCE_MESSAGES` exported from `infrastructure/source/local/messages.ts`
- `DEFAULT_SOURCE_NAME` moved to `infrastructure/source/constants.ts`, re-exported from barrel
- Removed `source.git`, `source.local`, `source.defaultName` from `init/messages.ts`
- **Dir-per-assistant** in `domain/assistants/` — each assistant is now `<name>/index.ts` instead of `<name>.ts`, ready for future per-assistant files (transformers, schemas, etc.)
- Test files renamed: `index.test.ts` → `loader.test.ts` in each source dir; import directly from focused files
- Handler unit tests no longer know about source prompt message strings — mocks `configure()` directly

---

## [0.1.3] — 2026-05-06

### Changed

- **`forge init` assistant selection is now a single multiselect** — replaced per-assistant confirm prompts with one `multiselect` showing all assistants at once
- Detected assistants are pre-selected with a `"detected"` hint
- `prompts.multiselect` wrapper now supports `initialValues` (passed through to `@clack/prompts`)
- `SPACE` key constant added to e2e helpers
- Updated all unit and e2e tests for the new interaction model

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
