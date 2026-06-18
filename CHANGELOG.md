# Changelog

All notable changes to `@crucible/forge-cli` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.6.11] — 2026-06-18

### Changed

- **Source edit pre-fills existing values** — editing a source in `forge config` now shows current url, branch, path, layout, include, exclude, and map as defaults instead of blank prompts.
- **Advanced source options gate defaults to Yes** when editing a source that already has layout, include, exclude, or map configured.
- **Current value hints** in source layout select and sync settings selects show `(current)` next to the active option.

---

## [0.6.10] — 2026-06-18

### Added

- **Sync settings wizard** — new "Sync settings" section in `forge config` and "Configure sync settings?" gate in `forge init` exposing all 4 sync options: source conflict strategy, local conflict strategy, backup, and keep-local.
- **Shared sync prompt** — `promptSyncSettings()` in `shared/sync.prompt.ts` reusable across init and config commands.

---

## [0.6.9] — 2026-06-18

### Added

- **Source layout override** — `layout` field on source config (`auto`, `canonical`, `pre-structured`) to explicitly control how source files are interpreted instead of relying on auto-detection.
- **Advanced source options wizard** — interactive prompt gate "Configure advanced source options?" during `forge init`, `forge config`, and `forge source add` that exposes layout selection, include/exclude patterns, and map prefix.

### Changed

- Renamed internal filter gate to unified "advanced source options" gate covering layout + filtering in one flow.

---

## [0.6.8] — 2026-06-17

### Added

- **Source filtering** — `include` and `exclude` glob patterns on source config to control which files are synced (e.g. `include: ["skills/**"]` to sync only skills from a large repo).
- **Source mapping** — `map` field on source config to prepend a virtual directory prefix, allowing flat sources to be placed into canonical structure (e.g. `map: "skills"` turns `SKILL.md` into `skills/SKILL.md`).
- **`loadSourceFiles()`** — new infrastructure function encapsulating the full source pipeline (load → collect → filter/map), keeping command handlers clean.

---

## [0.6.7] — 2026-06-11

### Changed

- **Design doc cleanup** — marked `docs/forge-v0.1` through `v0.5` as ✅ implemented, updated `forge-v0.6.md` with shipped status for logging, health, README, CONTRIBUTING, and LICENSE.
- **Monorepo design docs** — added status annotations to `design/crucible-architecture.md`, `crucible-first-cli.md`, and `crucible-project-structure.md` noting stale references (binary name, config path, Go rewrite) while preserving content as historical record.

---

## [0.6.6] — 2026-06-11

### Added

- **MIT License** — `LICENSE` file and `license` field in `package.json`.
- **CONTRIBUTING.md** — setup, testing, architecture overview, code style, and commit conventions.

---

## [0.6.5] — 2026-06-10

### Changed

- **TargetMapping destination** — `destination` is now a `{project, global?}` object instead of a plain string, supporting separate project and global paths per assistant mapping.
- **Global destination fallback** — resolver falls back to `project` path when `global` is not defined, so only mappings with genuinely different global paths need a `global` field.
- **Global mode state** moved to `domain/scope/` — `isGlobalMode`/`setGlobalMode` live in domain, resolver reads scope directly instead of threading a parameter through all functions.
- **Cline global paths** — use `~/Cline/Rules/` and `~/Cline/Workflows/` per official Cline docs.
- **Windsurf rules** — project-only (global rules is a single file, not a directory).
- Updated all assistant definitions (Claude Code, Cursor, Windsurf, Copilot, Cline) with correct project/global paths.
- Updated resolver tests, layout, reader, and registry to use new `destination.project` accessor.

### Fixed

- **Health report** — renamed misleading "Config drift" label to "Sync drift" (it checks synced files, not config).

---

## [0.6.4] — 2026-06-10

### Added

- **`forge source` command** — manage sync sources from the CLI:
  - `forge source list` — show configured sources with type, detail, and synced file counts.
  - `forge source add` — add a new source interactively (reuses shared prompts).
  - `forge source remove` — remove a source with optional cleanup of synced files and sync state.
  - Running `forge source` with no subcommand defaults to `list`.
- **Source cleanup on remove via `forge config`** — when removing a source through the config editor, now prompts to clean synced files too.
- **Shared source cleanup utilities** (`shared/source.cleanup.ts`) — `getFilesForSource`, `countFilesForSource`, `removeSourceFromState`, `deleteSourceFiles` used by both `forge source remove` and `forge config` source section.
- Unit tests for source cleanup utilities and source handler.
- E2E tests for `forge source list`, `forge source add`, and `forge source remove` (split into `e2e/commands/source/`).

### Fixed

- Flaky report history test — check entry ordering instead of absolute last position.
- Config source section test missing `loadSyncState`/`writeSyncState` mocks after cleanup feature was added.

---

## [0.6.3] — 2026-06-09

### Added

- **`forge health` command** — SLI dashboard showing last sync, sync frequency, sync drift, source reachability, active assistants, log and report stats.
- **Sync Reports** — every `forge sync` now produces a `SyncReport` written to `~/.crucible/forge/reports/`:
  - `latest.json` — always the most recent sync result.
  - `history/YYYY-MM-DD-HHmmss.json` — retained for 30 days (matches log rotation).
- **`SyncReport` domain type** (`domain/sync/report.ts`) — captures timing, file counts (synced/skipped/conflicts/errors), drift details, and success status.
- **`infrastructure/report` module** — report writer, reader, and 30-day rotation.
- E2E tests for `forge health` and sync report generation.
- Unit tests for `buildSyncReport`, report service, and `forge health` handler.

### Changed

- **Extracted `resolveForgeCommand`** from 3 copies into `application/commands/shared/resolve-command.ts`.
- **Extracted date formatters** (`formatTimeAgo`, `formatDateTime`, `formatShortDateTime`) into `domain/format/` — removed duplicates from status/display, health/handler, scheduler/handler, status/handler.
- **SyncReport conflicts count** now correctly counts skipped-due-to-conflict files instead of always 0.

---

## [0.6.2] — 2026-06-09

### Added

- **`forge init` — offer to install scheduler** after setting a schedule during init wizard.
- **`forge config` scheduler section — offer to install scheduler** immediately after setting a schedule.
- **`forge status` — rich context when no sync state exists:**
  - Shows assistants, sources, schedule, and scheduler install status.
  - Smart hints based on state: next auto-sync time, missing scheduler install, no sources, or manual sync suggestion.
- **`forge scheduler install` — warn if no sources configured** (scheduler would have nothing to sync).

### Changed

- **`forge sync` no-source error** now suggests `forge config` (not `forge init`) when config already exists.

### Fixed

- Log level filtering test now handles large log files without false failures.

---

## [0.6.1] — 2026-06-09

### Added

- **`debugCommandHook`** — program-level `preAction` hook that logs every command invocation with its name and options at debug level. Automatic coverage for all current and future commands.

### Changed

- **Structured logging injected across all commands and source loaders.**
  - `forge init` — logs config creation with assistants, sources, and schedule.
  - `forge config` — logs config updates and missing-config warnings.
  - `forge scheduler` — logs install, uninstall, schedule changes, and errors.
  - `forge status` — logs drift check results at debug level.
  - Git source loader — logs clone vs fetch, cache state at debug level.
  - Local source loader — logs path resolution and missing-path errors.

---

## [0.6.0] — 2026-06-09

### Added

- **Structured logging via pino** — all sync events are written as JSON lines to `~/.crucible/forge/logs/forge-YYYY-MM-DD.jsonl`.
- `FileLogger` interface with `error`, `warn`, `info`, `debug`, `trace` methods and structured data support.
- `--log-level <level>` program option (silent, error, warn, info, debug, trace) — controls file log verbosity.
- `setLogLevel` / `getLogLevel` module state with `preAction` program hook.
- Date-based log files with automatic rotation (deletes files older than 30 days).
- `readRecent()` reads across the last 5 daily log files for `forge scheduler status`.
- 8 unit tests for file logger (interface, state, writing, reading, filtering, rotation).

### Changed

- Replaced custom plain-text `SchedulerLogger` with pino-based `FileLogger`.
- Log path moved from `~/.crucible/logs/scheduled/forge.sync.log` to `~/.crucible/forge/logs/`.
- Sync handler now logs key events: start, resolve, conflicts, completion, errors.

---

## [0.5.1] — 2026-06-09

### Added

- **Hybrid source layout** — sources can now mix canonical files (`rules/`, `skills/`) with assistant-specific directories (`.claude/`, `.cursor/`, etc.). Canonical files are transformed and distributed to all enabled assistants; pre-structured files are copied as-is to their original paths.
- `SOURCE_LAYOUTS.HYBRID` layout type, auto-detected when both patterns are present.
- `partitionByLayout()` splits source files for independent resolution.
- 3 unit tests for hybrid resolver, 3 for `partitionByLayout`, 2 e2e tests for mixed sources.

---

## [0.5.0] — 2026-06-09

Milestone: **"Smart Sources"** — pre-structured source layouts, global config support.

### Added

- **Pre-structured source layout** — sources containing assistant-specific directories (`.claude/`, `.cursor/`, `.windsurf/`, `.github/`, `.cline/`) are auto-detected and copied as-is without transforms.
- **Layout auto-detection** — `detectSourceLayout()` classifies sources as `canonical` or `pre-structured` based on top-level directory names. No config field needed — forge always does the right thing.
- **Global config (`--global`)** — `forge --global <command>` operates on `~/.crucible/forge.config.yaml` and syncs to `~/`.

### Changed

- `collectFiles()` now includes known assistant dot-directories (`.claude/`, `.cursor/`, etc.) at source root.
- **Resolver encapsulation** — `resolveTargets()` auto-detects layout and dispatches via `Record<SourceLayout, ResolverFn>` map. Sync handler calls one function with zero layout knowledge.
- `SOURCE_LAYOUTS` const object replaces string literals; `SourceLayout` type derived from it.
- Program-level options and hooks extracted to `application/program.ts` + `application/hooks.ts`.

---

## [0.4.5] — 2026-06-03

### Added

- **Cron validation in config schema** — `sync.schedule` is now validated via zod refine on config load. Invalid cron expressions are rejected at parse time with a clear `"Invalid cron expression"` error, not just at scheduler install.
- 3 e2e tests for `forge sync --silent` (no output on success, files still synced, non-zero exit on missing config).
- 4 unit tests for cron schedule validation in config schema.

---

## [0.4.4] — 2026-06-03

### Added

- **Next run display** in `forge scheduler status` — shows the next scheduled run date/time calculated from the cron expression (via `cron-parser`).
- **30-day log rotation** — scheduled sync runs (`--silent`) automatically prune log entries older than 30 days after each run.

### Dependencies

- Added `cron-parser@5.5.0` for next cron occurrence calculation.

---

## [0.4.3] — 2026-06-03

### Changed

- **Native OS scheduler backend** — replaced `Bun.cron` with direct OS-level job registration. No runtime dependency on `bun` binary.
  - **macOS**: launchd plist in `~/Library/LaunchAgents/` with `StartCalendarInterval` for fixed times, `StartInterval` for intervals
  - **Linux**: crontab entry with comment markers for clean install/uninstall
  - **Windows**: Task Scheduler via `schtasks.exe` with cron-to-schedule mapping (daily, weekly, minute/hour intervals)
- **Self-registering scheduler registry** — each platform scheduler lives in its own file and registers itself. Adding a new platform requires zero changes to existing code.
- Scheduler command is now passed as a full string from the application layer — infrastructure schedulers are command-agnostic.
- Removed `worker.ts` — scheduler no longer needs a separate worker script.
- **macOS**: use `launchctl bootstrap/bootout` instead of deprecated `load/unload`.
- **macOS**: use `process.getuid()` instead of spawning `id -u`.

### Fixed

- **Compiled binary scheduler install** — `dist/forge scheduler install` no longer fails with "Failed to resolve path". The job runs the forge binary directly instead of requiring a `.ts` worker file.
- **Crontab reinstall orphan bug** — `install` now removes both the marker comment and the command line below it, preventing orphan entries on schedule update.
- **Launchd step value crash** — cron expressions like `*/5 * * * *` now correctly use `StartInterval` instead of producing invalid plist XML.
- **Paths with spaces** — crontab entries now quote `projectRoot`, schtasks quotes all command arguments.

---

## [0.4.2] — 2026-06-03

### Added

- **Interactive `forge scheduler`** — running with no subcommand shows current status, then offers an action menu (install / uninstall / change schedule / done) with a "anything else?" loop. Status refreshes after each action.
- **Cron preview + confirm** — `promptSchedule()` now shows a human-readable description after input (e.g. `→ At 09:00, only on Monday`) and asks to confirm before saving. Declines loop back to re-enter.
- CLI parser now supports parent action + subcommands simultaneously (parent runs when no subcommand given).
- 4 unit tests for interactive scheduler menu.

### Fixed

- Install output no longer shows misleading "registered" warning before the actual install attempt.

---

## [0.4.1] — 2026-06-03

### Added

- **Scheduler section in `forge config`** — set, change, or clear the `sync.schedule` cron expression interactively.
- **Schedule prompt in `forge init`** — optional step after sources to configure automatic sync schedule.
- **Shared `promptSchedule()`** — reusable cron input prompt with inline validation via `Bun.cron.parse()` and human-readable preview via `cronstrue`. Context-aware: shows current value when editing, example when new.
- 6 unit tests for the scheduler config section.

---

## [0.4.0] — 2026-06-03

Milestone: **"Auto-Pilot"** — scheduled sync via OS-level cron, `forge scheduler` commands, unattended error logging.

### Added

- **`forge scheduler install`** — registers an OS-level cron job via `Bun.cron` (launchd on macOS, crontab on Linux, Task Scheduler on Windows).
- **`forge scheduler uninstall`** — removes the registered scheduled task.
- **`forge scheduler status`** — shows whether the scheduler is installed, the schedule description, last run info, and log path.
- **Subcommand support** in CLI parser — `CommandDefinition` now supports optional `subcommands[]` array, handled by Commander.
- **`--silent` flag** on `forge sync` (optional) — suppresses all console output for unattended/scheduled runs. Errors still cause non-zero exit.
- **`sync.schedule`** config field — optional cron expression (e.g. `"0 9 * * 1"`) for automatic sync.
- **Scheduler infrastructure** — `Bun.cron` OS-level API with worker script (`scheduled()` handler), cross-platform out of the box.
- **File logger** — `infrastructure/logger/` writes timestamped log entries (`[ts] LEVEL | message`) to `~/.crucible/logs/scheduled/forge.sync.log`.
- **Cron validation** via `Bun.cron.parse()`, **human-readable descriptions** via `cronstrue`.
- **Shared messages** — `noConfig`/`noConfigHint` extracted to `shared/messages.ts`, reused across sync, status, and scheduler.
- 6 unit tests (cron + logger) + 6 e2e tests (scheduler commands).

---

## [0.3.11] — 2026-06-02

### Added

- **`keep_local: false` file cleanup** — when `sync.keep_local` is `false` in config, files tracked in sync state but no longer present in any source are deleted on sync. Default remains `true` (keep stale files).
  - `DELETED` status added to `SYNC_FILE_STATUSES` for display.
  - Stale file detection compares sync state keys against resolved target paths.
  - 3 unit tests + 4 E2E tests for keep_local behavior (default keep, explicit delete, dry-run, still-in-source).
- **Rich `forge status` output** — status now fetches remote sources and compares with local state using `detectFullDrift()`:
  - `↓` remote updated — source changed, local unchanged
  - `✗` conflict — both local and remote changed
  - `+` new in source — file added to source since last sync
  - `-` removed from source — file no longer in any source
  - Falls back gracefully to simple drift detection when sources are unavailable.
  - 8 unit tests for `detectFullDrift()`.
- **Strategy banner** in `forge sync` output — shows active source and local conflict strategies before file list.
- **Summary counters** in sync output for deleted, skipped, and error counts.

### Changed

- `forge sync` output message uses `file(s)` instead of `files` for consistency.
- `displayPlan()` now accepts `SyncConfig` for strategy banner rendering.
- `DRIFT_STATUSES` extended with `remote_updated`, `conflict`, `new_in_source`, `removed_from_source`.
- Drift renderers in `infrastructure/cli/renderer.ts` extended for all new statuses.

---

## [0.3.10] — 2026-05-22

### Added

- **`forge status`** — new command showing drift between last sync state and current filesystem.
  Reads `sync-state.json`, hashes each tracked file on disk, and displays per-assistant drift grouped by status.
  - `✓` in sync — file unchanged since last sync
  - `✗` locally modified — disk hash differs from stored hash
  - `-` deleted — file removed from disk
- **Drift detection** (`domain/sync/drift.ts`) — pure function `detectDrift()` comparing sync state hashes against disk content. Returns `DriftSummary` with `in_sync`, `modified`, or `deleted` per file.
- **`DRIFT_STATUSES`** const object with derived `DriftStatus` type.
- **`formatTimeAgo()`** — human-readable relative time for last sync display.
- 7 unit tests for drift detection, 13 unit tests for status handler/display, 6 E2E tests covering never-synced, all-in-sync, modified, deleted, mixed drift, and missing config.

### Changed

- **DDD layering cleanup** — removed direct `node:fs` usage from application handlers:
  - `readFileContent()` and `readDiskContents()` moved to `infrastructure/fs/reader.ts`.
  - `sync/handler.ts` now uses `readFileContent` from `@infrastructure/fs` instead of `existsSync`/`readFile`.
- **`resolveAssistantByPath()`** added to `domain/assistants/registry.ts` — derives assistant from `targetMappings.destination`, replacing hardcoded path prefixes.
- **Drift renderers** moved from status handler to `infrastructure/cli/renderer.ts` (consistent with `syncStatusRenderers`).
- **Status handler split** — `handler.ts` is now a thin orchestrator; display logic lives in `display.ts`.

---

## [0.3.9] — 2026-05-22

### Added

- **Local conflict strategy** (`domain/sync/conflict.ts`) — detects when a locally modified file also changed remotely since last sync. Three strategies:
  - `remote-wins` (default): overwrite local changes
  - `local-wins`: skip the file, keep local edits
  - `error`: abort sync with conflict details
- **Backup support** — when `sync.backup: true` (default) and `remote-wins` overwrites a locally modified file, a `.bak` copy is created before overwriting.
- **`LocalConflictError`** — custom error with structured `conflicts` array for batch reporting.
- **`detectLocalConflict()` + `resolveLocalConflict()`** — pure domain functions using sync state hashes for three-way comparison (local vs stored vs remote).
- **`skipped` sync file status** — files kept by `local-wins` render with `⊘` indicator.
- 5 unit tests for conflict detection/resolution, 9 E2E tests covering all strategies, backup on/off, and non-conflict edge cases.

### Changed

- **Const object pattern for all domain literals** — `SYNC_FILE_STATUSES`, `MUTATION_TYPES`, `CONFLICT_ACTIONS` replace bare string unions. Renderer, handler, mutations, and rollback all use computed keys.
- **`buildPlan` refactored** — extracted `classifyExisting()` and `processTarget()` as hoisted closured functions, reducing nesting in the main loop.
- All `mock.module('@infrastructure/config')` stubs now include `loadSyncState` to prevent Bun mock leak across test files.
- Removed unused `SyncPlan` and `SyncResult` types.

---

## [0.3.8] — 2026-05-21

### Added

- **Source conflict resolution** (`domain/sync/merge.ts`) — pure function `resolveSourceConflicts()` deduplicates targets when multiple sources produce the same `targetPath`.
  - Strategies:
    - `last-wins`: later source wins
    - `first-wins`: earlier source wins
    - `error`: throw with conflict details
- **`SourceConflictError`** — custom error with structured `conflicts` array listing all colliding paths and their sources.
- **Sync handler integration** — `runSync` now applies `source_conflict_strategy` (from config or default `last-wins`) between fetch and plan phases. Strategy `error` aborts sync with clear error message.
- 11 unit tests covering all three strategies, edge cases (same-source duplicates, order preservation).
- **E2E: source conflict tests** (`e2e/commands/sync/conflicts.test.ts`) — 5 tests covering last-wins (default + explicit), first-wins, error strategy, and non-conflicting multi-source sync.
- **E2E: rollback tests** (`e2e/commands/sync/rollback.test.ts`) — 3 tests covering rollback of written files on mutation failure, cleanup of new files, and error reporting.
- **`buildConfigYaml` extended** — supports `localSources[]` (multiple local sources) and `sync` config block for E2E test setup.

---

## [0.3.7] — 2026-05-21

### Added

- **Source naming prompt** — `promptNewSource()` now asks for a source name during init/config with smart defaults (`default` for first, `source-N` for subsequent). Validates against duplicates.
- **Sync config block** — new `sync` section in project config schema supporting `source_conflict_strategy`, `local_conflict_strategy`, `backup`, and `keep_local`. All fields optional with sensible defaults.
- **Const object literals for strategies** — `SOURCE_CONFLICT_STRATEGIES` and `LOCAL_CONFLICT_STRATEGIES` as single source of truth, replacing repeated string literal unions. Zod schema derives enums from these objects.

### Changed

- `promptNewSource()` signature simplified — removed redundant `existingCount` param, reuses `placeholder()` for default value.

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
