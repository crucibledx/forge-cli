# Changelog

All notable changes to `@crucible/forge-cli` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.6] — 2026-05-21

### Added

- **Sync state** (`sync-state.json`) — SHA-256 content hashes written to `.crucible/sync-state.json` after each successful sync. Domain types + helpers in `domain/sync/state.ts`, infrastructure read/write in `infrastructure/config/state.ts`.
- **`sourceName` on `ResolvedTarget`** — each resolved target now carries its source name for sync state tracking. `resolveTargets()` accepts optional `sourceName` parameter.
- **`buildSyncState()`** — pure domain function that builds `SyncState` from resolved targets.
- **Sync handler writes state** — `executePlan()` now builds and persists sync state, and uses its `lastSync` timestamp for config update.

### Fixed

- All `mock.module('@infrastructure/config')` test stubs now include `writeSyncState` to prevent Bun test runner cross-file mock conflicts.

---

## [0.3.5] — 2026-05-21

### Changed

- **Removed global/project config merging** — global and project configs are now fully independent scopes (per v0.5 design). Deleted `mergeConfigs()`, `GlobalConfig` type, and `defaults` wrapper from global schema. Global config now uses the same schema as project config.
- **Simplified IOContext** — removed `globalConfig` field. `buildContext()` only loads project config.
- **Sync handler** — no longer merges configs; uses `projectConfig` directly with explicit "no config" error when missing.

### Removed

- `domain/config/merge.ts` + `merge.test.ts` — config merging logic (15 tests removed).
- `loadGlobalConfig()` and `getGlobalConfigPath()` from config infrastructure barrel — will be re-added when `--global` flag is implemented.

---

## [0.3.4] — 2026-05-20

### Added

- **E2E testing framework** (`e2e/framework/`) — replaced monolithic `helpers.ts` with focused modules: `spawn.ts` (PTY session), `run.ts` (non-interactive runner + per-command helpers), `keys.ts` (terminal constants), `config.ts` (config reader), `constants.ts` (CLI entry, timeout), `git.ts` (`createBareRepo` for git source tests).
- **E2E fixtures module** (`e2e/fixtures/`) — reusable test data builders: `buildConfigYaml()` (local + git sources), `writeConfig()`, `setupLocalSync()`, `writeSourceTree()`, `readTarget()`, and sample content constants (`RULE_WITH_PATHS`, `SKILL_DEPLOY`, etc.).
- **Sync e2e tests** — 26 tests across 4 files:
  - `local.test.ts` — core sync flow: placement, dry-run, idempotency, update detection, multi-assistant, empty source
  - `transforms.test.ts` — per-assistant transform coverage: cursor (rename + frontmatter), copilot (rename + frontmatter), windsurf (frontmatter only), claude-code (passthrough), no-frontmatter passthrough
  - `git.test.ts` — git source via local bare repo: skills sync, transforms, custom branch
  - `edge-cases.test.ts` — missing config, no sources, disabled assistants, nonexistent path, spaces in filenames, nested dirs, 50-file performance (with real file count verification)
- **v0.5 design doc** (`docs/forge-v0.5.md`) — "Smart Sources": pre-structured source support, layout detection, passthrough mode for shared repos with assistant-specific directories.

### Changed

- **E2E test restructure** — moved tests from `e2e/` root to `e2e/commands/` with command-specific subfolders. Deleted old `helpers.ts`. Consolidated `runConfigSession` and `runInitSession` into `framework/run.ts`.

### Fixed

- **Transform self-registration** — transforms were never loaded at runtime because `@domain/transforms` barrel (with side-effect imports) was not imported by `main.ts`. Added `import '@domain/transforms'` to `main.ts`.

---

## [0.3.3] — 2026-05-20

### Added

- **Sync handler unit tests** — 18 tests covering `validateConfig`, `buildPlan`, `displayPlan`, `executePlan`. Tests use real filesystem for `buildPlan` (temp dirs) and mock infrastructure boundary for renderer/fs/config/io.
  Covers: new/update/no_change/error statuses, mixed file sets, per-file error recovery, dry-run rendering, rollback on failure, config write skip when null.

---

## [0.3.2] — 2026-05-20

### Changed

- **Parallel source fetching** — all sources are fetched concurrently via `Promise.allSettled`, then resolved sequentially. Failed sources are reported but don't block others.
- **Per-file error handling** — `buildPlan` catches errors per target file (e.g. permission denied, binary read failure). Failed files get `status: 'error'` and are excluded from mutations. Error count shown in summary.
- **`SyncFileStatus` type** — new `'error'` status added to `SyncFileSummary`, rendered with red `✗` in output.
- Spinner removed from fetch phase (parallel fetching renders status after all sources complete).

---

## [0.3.1] — 2026-05-20

### Changed

- **Sync handler messages extracted** — all user-facing strings moved to `sync/messages.ts`, consistent with init/config pattern.
- **Sync handler split into focused functions** — `runSync` is now a thin orchestrator calling `validateConfig`, `fetchAndResolve`, `buildPlan`, `displayPlan`, `executePlan`. Each function has a single responsibility and typed inputs/outputs.

---

## [0.3.0] — 2026-05-20

### Milestone — "Sync Solid"

*See `docs/forge-v0.3.md` for design.*

---

## [0.2.0] — 2026-05-20

### Milestone — "Config Control"

### Added

- **`forge config`** — interactive config editor with registry-driven section select loop. Each config section (assistants, sources) is a self-contained editor registered via self-registration pattern. The handler is generic — zero changes needed when adding new sections.
- **Multi-source support** — `source:` becomes `sources:` (array). Auto-migration wraps existing single source. Init gains "Add another source?" loop with auto-naming.
- **Sync handler iterates all sources** — `forge sync` pulls and resolves files from every configured source.
- **Shared prompts** — assistant detection+multiselect and source type+configure extracted to `commands/shared/`, reused by both init and config.

### Changed

- **Self-registering transformer pipeline** — replaced string-based `transform`/`contentTransform` fields with `transforms: TransformStep[]` array. Each transformer is a self-contained module in `domain/transforms/<name>/` with `TransformContext` pipeline (`{filename, content}` in → out). No closed type union — fully open for extension.
- **Self-registering modules across the board** — commands, assistants, config sections, source loaders, source schema, and transformers all use the same mutable-registry + side-effect-import pattern. Adding a new variant requires only creating a file and a barrel import.
- **Security hardening on transformers** — rename rejects path separators in params; frontmatter-rename uses `escapeRegExp` and rejects newlines to prevent YAML injection.
- **Dynamic source config schema** — `sourceConfigSchema` built from `loadersRegistry` at import time instead of hardcoded discriminated union.
- **Prettier replaces @stylistic/eslint-plugin** — formatting fully delegated to Prettier, ESLint handles code quality only.

### Documentation

- `docs/how-to-add-command.md`
- `docs/how-to-add-assistant.md`
- `docs/how-to-add-config-section.md`
- `docs/how-to-add-transformer.md`

**Dropped from earlier v0.2 plans:** `forge config set/show/diff/promote`, `forge update`, config layers (local/project/global).

---

## [0.1.9] — 2026-05-06

### Added

- **Local path validation at configure time** — the local source loader now validates the path inline (before the wizard exits): empty → re-prompts with "Path is required"; path doesn't exist → "Directory not found"; path is a file → "Path exists but is not a directory". Uses `~` expansion consistent with `load()`.
- **Git source connectivity check** — after collecting URL/branch/subdirectory, a spinner runs `git ls-remote --exit-code <url> refs/heads/<branch>` with a 10s timeout and `ConnectTimeout=5` for SSH. On success: "Source verified". On failure: warning with the error detail — source is still saved, user can fix access and verify with `forge sync --dry-run`.
- `GIT_TERMINAL_PROMPT=0` applied to all git operations to prevent interactive credential prompts.
- Exported `validateLocalPath` and `verifyGitSource` for direct unit testing.
- `log` (clack inline logging) added to `@infrastructure/cli/prompts` barrel.
- 5 new unit tests: `validateLocalPath` (empty, valid, not-found, file, ~ expansion); `verifyGitSource` (success, failure).

---

## [0.1.8] — 2026-05-06

### Fixed

- **Recursive file check for directory detection** — replaced the shallow entry-count check with a recursive `hasAnyFile()` scan. A directory is only detected if it contains at least one non-hidden *file* anywhere in its tree. Empty subdirectories (e.g. `~/.claude/skills/` auto-created by Claude Code on first launch) no longer falsely trigger detection.
- Removed misleading item-count label from directory evidence (was `".claude/ found (1 items)"`, now `.claude/ found`).
- 2 new unit tests: empty-subdirectory non-detection, nested-file detection.

---

## [0.1.7] — 2026-05-06

### Changed

- **Config-exists check moved before scan** — `forge init` now aborts immediately if `.crucible/forge.config.yaml` already exists, before the detection spinner even starts. No wasted work.
- **Conditional outro** — if no source was configured, the outro now reads *"Done. Add a source to .crucible/forge.config.yaml to enable sync."* instead of the misleading sync hint.
- **Warning on zero assistants** — if the user confirms the multiselect with nothing selected, a warning is shown: *"No assistants selected — edit .crucible/forge.config.yaml to add some later."* Config is still written.
- **Global detection hint shows actual path** — the multiselect hint for globally detected assistants now shows the evidence path (e.g. `~/.claude/ found (3 items)`) instead of the generic `"detected globally"`.
- 2 new unit tests: abort-before-scan, no-assistants warning.
- 2 new e2e tests: no-assistants warning output, no-source outro output.

---

## [0.1.6] — 2026-05-06

### Changed

- **Empty directories are no longer detected** — a directory must contain at least one non-hidden item to count as evidence. An empty `~/.claude/` or `.cursor/` is treated as an install artifact, not active configuration.
- Files are unaffected — their existence alone is still a valid detection signal.
- Updated scanner unit tests: empty-dir test now expects `detected: false`; 1 new unit test for empty global dir; non-empty dir tests now explicitly write a file.
- 1 new e2e test: empty `.cursor/` dir does not pre-select Cursor in the multiselect.

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
