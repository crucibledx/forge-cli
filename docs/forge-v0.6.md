# Forge CLI — v0.6 Architecture & Design

> **Milestone:** Forge v0.6 — "Production Ready"
>
> **Prerequisite:** Forge v0.5 shipped (smart sources, global forge).
>
> **Scope:** Observability, structured logging, telemetry, documentation,
> public distribution, and support infrastructure. Everything needed to
> hand Forge to a real user and keep it running.

---

## Motivation

Forge works. It syncs configs, detects drift, resolves conflicts, runs on a schedule. But it's not **operable**. A user can't tell if forge is healthy, a team lead can't measure its impact, and there's no support path when something breaks.

Craft Conference 2026 validated demand from 8+ companies. Every one of them said some version of: *"show me when it's ready."* This milestone makes it ready.

Abby Bangser's walking skeleton framework (Craft 2026) defines the gap clearly:

| Phase              | Requirement                                                        | Forge Status  |
|--------------------|--------------------------------------------------------------------|---------------|
| Build the frame    | Hello world, contract/API, DDD, accessible                         | ✅ Done        |
| Start walking      | Test suites, operable framework, SLIs, delivery mechanism, support | ⚠️ Partial    |
| Finishing the look | Scaling, contributor model, marketplace, validation                | ❌ Not started |

v0.6 closes the "start walking" gap.

---

## Feature 1: Structured Logging

### Current State

- Forge uses `@clack/prompts` for interactive output and `picocolors` for formatting
- Scheduler writes raw text to `~/.crucible/forge/logs/`
- No structured format, no log levels, no machine-readable output

### Design

#### Log Levels

```
silent < error < warn < info < debug < trace
```

Default: `info` for interactive, `debug` for scheduler runs.

Configurable via:

- CLI flag: `--log-level <level>`
- Environment variable: `FORGE_LOG_LEVEL`
- Config: `logging.level` in `forge.config.yaml`

#### Structured Format (JSON Lines for non-interactive)

When `--json` flag is passed or when running in scheduler/CI mode (no TTY):

```jsonl
{"ts":"2026-06-07T12:00:00Z","level":"info","msg":"sync started","source":"team-rules","assistants":["claude-code","windsurf"]}
{"ts":"2026-06-07T12:00:01Z","level":"info","msg":"files synced","count":12,"skipped":2,"conflicts":0}
{"ts":"2026-06-07T12:00:01Z","level":"info","msg":"sync completed","duration_ms":1200}
```

When interactive (TTY detected), keep current `@clack/prompts` output unchanged.

#### Log Destination

| Mode                | Destination                                     |
|---------------------|-------------------------------------------------|
| Interactive         | stdout via @clack/prompts (unchanged)           |
| Scheduler           | `~/.crucible/forge/logs/forge-YYYY-MM-DD.jsonl` |
| CI/non-TTY          | stdout as JSON lines                            |
| `--log-file <path>` | Custom file path                                |

#### Implementation

New infrastructure module: `src/infrastructure/logging/`

- `types.ts` — `Logger` interface, `LogLevel`, `LogEntry`
- `interactive.ts` — wraps current @clack/prompts output
- `structured.ts` — JSON lines writer
- `index.ts` — barrel, factory function that picks logger based on TTY detection

```typescript
// types.ts
interface Logger {
    error(msg: string, data?: Record<string, unknown>): void

    warn(msg: string, data?: Record<string, unknown>): void

    info(msg: string, data?: Record<string, unknown>): void

    debug(msg: string, data?: Record<string, unknown>): void

    trace(msg: string, data?: Record<string, unknown>): void
}
```

Handlers receive `Logger` via context, not global import. This keeps testability.

---

## Feature 2: Health Metrics & Drift Reporting

### Sync Report

Every `forge sync` produces a `SyncReport`:

```typescript
interface SyncReport {
    timestamp: string
    duration_ms: number
    source: string
    assistants: string[]
    files: {
        synced: number
        skipped: number
        conflicts: number
        errors: number
    }
    drift: {
        detected: boolean
        files_drifted: number
        details: DriftEntry[]
    }
}
```

#### Report Storage

Reports written to `~/.crucible/forge/reports/`:

- `latest.json` — always the most recent sync
- `history/YYYY-MM-DD-HHmmss.json` — retained for 30 days (matches log rotation)

#### `forge health` Command (new)

```
$ forge health

Forge Health Report
  Last sync:        2 hours ago (success)
  Sync frequency:   every 4 hours (scheduler active)
  Config drift:     2 files drifted since last sync
  Sources:          1 configured, 1 reachable
  Assistants:       3 active (claude-code, windsurf, cursor)
  Logs:             ~/.crucible/forge/logs/ (12 files, 2.1 MB)
  Reports:          ~/.crucible/forge/reports/ (45 entries)
```

This is the "SLI dashboard" for Forge. Teams can run `forge health` to answer: *"is forge working?"*

---

## Feature 3: Telemetry (Opt-in)

### Principle

Anonymous, opt-in, transparent. User must explicitly enable it. No tracking by default.

### What We Collect (when opted in)

```typescript
interface TelemetryEvent {
    event: 'sync' | 'init' | 'config' | 'status' | 'health'
    forge_version: string
    os: string
    assistants: string[]          // which assistants are configured
    source_types: string[]        // git, local, http
    file_count: number            // how many files synced
    duration_ms: number
    success: boolean
    // NO: repo names, file contents, paths, user identity
}
```

### Opt-in Flow

```
$ forge telemetry enable
$ forge telemetry disable
$ forge telemetry status
```

Config field: `telemetry.enabled: true | false` (default: false).

First `forge init` after v0.6 asks once:

```
? Help improve Forge by sharing anonymous usage data? (No personal data, no file contents)
  > Yes, I'd like to help
    No thanks
    What data is collected? (show details)
```

### Backend

Deferred. For now, write telemetry events to `~/.crucible/forge/telemetry/` as JSON lines. When a backend exists, batch-upload on sync. This means telemetry collection works offline and the storage format is ready for any future backend.

---

## Feature 4: Public Distribution

### npm

```bash
npm install -g @crucible/forge-cli
# or
npx @crucible/forge-cli init
```

Package already configured in `package.json`. Needs:

- npm account setup under `@crucible` scope
- `prepublishOnly` script that runs `bun build --compile`
- Platform-specific binaries via `optionalDependencies` pattern (like `esbuild` does it)

### Homebrew Tap

```bash
brew tap crucible-dev/tap
brew install forge
```

Requires a `homebrew-tap` repo with formula pointing to GitHub release binaries.

### GitHub Releases

- CI workflow: on tag push, build binaries for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64
- Attach binaries to GitHub release
- Generate checksums

### Install Script (curl)

```bash
curl -fsSL https://crucible.dev/install.sh | sh
```

Fallback for users without Node.js or Homebrew.

---

## Feature 5: Documentation Site

### Minimum Viable Docs

| Page                 | Content                                             |
|----------------------|-----------------------------------------------------|
| Getting Started      | Install, `forge init`, `forge sync` in 2 minutes    |
| Configuration        | `forge.config.yaml` reference, all fields explained |
| Commands             | Every command with examples                         |
| Supported Assistants | What forge does for each AI tool                    |
| Architecture         | High-level overview for contributors                |
| FAQ                  | Common issues, troubleshooting                      |

### Stack

- VitePress or Starlight (Astro) — simple, markdown-based, good DX
- Hosted on GitHub Pages or Vercel
- Domain: `crucible.dev` or `forgedev.tools` (TBD)

### README Overhaul

Current README says v0.1. Needs full rewrite:

- Badges (version, tests, license)
- One-liner description
- Quick start (3 commands)
- Feature list
- Supported tools table
- Links to docs

---

## Feature 6: Support Infrastructure

### GitHub Discussions

- Categories: Q&A, Feature Requests, Show & Tell
- Templates for bug reports and feature requests

### Issue Templates

```
.github/
  ISSUE_TEMPLATE/
    bug_report.yml
    feature_request.yml
  DISCUSSION_TEMPLATE/
    support.yml
```

### CONTRIBUTING.md

- How to set up dev environment (bun install, bun run test)
- Architecture overview (DDD layers, module patterns)
- How to add: assistant, source, command, transformer (link to existing how-to docs)
- Code style (link to forge-cli.md rules)
- PR process

### LICENSE

Decision needed. Recommendation from previous analysis:

- `MIT` or `Apache-2.0` for forge-cli, anvil, cast (max adoption)
- `BSL` (Business Source License) for foundry (registry) when it exists

---

## Config Schema Additions

```yaml
# forge.config.yaml additions for v0.6
logging:
  level: info          # silent | error | warn | info | debug | trace
  file: null           # custom log file path, null = default location
  format: auto         # auto | json | text (auto = json if no TTY)

telemetry:
  enabled: false       # opt-in only

health:
  report_retention_days: 30
```

---

## Implementation Order

1. **Structured logging** — foundation for everything else
2. **Sync reports + `forge health`** — immediate user value
3. **Telemetry scaffolding** — collection only, no backend
4. **README + minimum docs** — unblocks public sharing
5. **npm publish + GitHub releases** — distribution
6. **Homebrew tap** — convenience
7. **GitHub Discussions + issue templates** — support channel
8. **CONTRIBUTING.md + LICENSE** — enables external contributors

---

## Success Criteria

- [ ] `forge sync --json` outputs structured JSON lines
- [ ] `forge health` shows meaningful status in one screen
- [ ] `npm install -g @crucible/forge-cli && forge init` works on a clean machine
- [ ] README has quick start, badges, and docs link
- [ ] At least one distribution method beyond npm (brew or curl script)
- [ ] LICENSE file exists in repo root
- [ ] Telemetry is opt-in only, privacy-respecting, with `forge telemetry status`

---

*Generated: 2026-06-07, driven by Craft Conference 2026 market validation*
