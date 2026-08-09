<div align="center">

# Forge CLI

**One source of truth for every AI tool your team uses.**

[![CI](https://github.com/crucibledx/forge-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/crucibledx/forge-cli/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.6.22-%23e84d00)](https://github.com/crucibledx/forge-cli/releases)
[![npm](https://img.shields.io/npm/v/@crucibledx/forge-cli?color=%23cb3837)](https://www.npmjs.com/package/@crucibledx/forge-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-%23a0aec0)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/dark/01-set-and-forget.gif">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/light/01-set-and-forget.gif">
  <img alt="Forge CLI — set and forget" src="https://github.com/crucibledx/assets/raw/main/forge/demos/light/01-set-and-forget.gif" width="720">
</picture>

</div>

---

Your team uses Claude Code, Cursor, Windsurf, Copilot, and Cline. Maybe all of them. Maybe different ones per repo.

Someone writes a great deployment skill for Claude Code — it lives in `.claude/skills/deploy.md`. The Cursor team never sees it. Copilot has its own version, three weeks out of date.

**10 repos × 5 AI tools = 50 config files.** Copy-paste. Drift. Nobody knows what's current.

Forge fixes that. Write your AI skills, rules, and workflows once. Sync them everywhere — in the right format, in the right place.

## Install

**Homebrew** (macOS / Linux)

```bash
brew install crucibledx/tap/forge
```

**Scoop** (Windows)

```powershell
scoop bucket add crucibledx https://github.com/crucibledx/scoop-bucket
scoop install forge
```

**npm / bun** (requires [Bun](https://bun.sh) runtime)

```bash
bun add -g @crucibledx/forge-cli
# or: npm install -g @crucibledx/forge-cli
```

**Shell script** (macOS / Linux — downloads standalone binary)

```bash
curl -fsSL https://raw.githubusercontent.com/crucibledx/forge-cli/main/scripts/install.sh | sh
```

**Manual download** — grab the binary for your platform from [Releases](https://github.com/crucibledx/forge-cli/releases), extract, and add to your `PATH`.

## Quick Start

```bash
forge init    # wizard detects your AI tools, configures a source
forge sync    # pulls files, transforms & places them for each tool
forge health  # dashboard: sync status, drift, source reachability
```

That's it. Commit `.crucible/forge.config.yaml` so the whole team stays in sync.

## How It Works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/platform/diagrams/dark/platform-flow.svg">
  <img alt="Platform Flow" src="https://github.com/crucibledx/assets/raw/main/platform/diagrams/light/platform-flow.svg">
</picture>

Define shared AI configs in a source repo:

```
my-source/
  skills/
    deploy.md
    testing.md
  rules/
    code-style.md
  workflows/
    review.md
```

Forge auto-detects the layout and maps each file to every assistant's native format:

| Assistant          | Target paths                                             | Auto-transform               |
|--------------------|----------------------------------------------------------|------------------------------|
| **Claude Code**    | `.claude/skills/`, `.claude/rules/`, `.claude/commands/` | —                            |
| **Cursor**         | `.cursor/rules/`                                         | `.md` → `.mdc` + frontmatter |
| **Windsurf**       | `.windsurf/rules/`, `.windsurf/workflows/`               | frontmatter injection        |
| **GitHub Copilot** | `.github/skills/`, `.github/instructions/`               | `.md` → `.instructions.md`   |
| **Cline**          | `.cline/skills/`, `.clinerules/`                         | —                            |

Only active tools are synced. If your project doesn't use Windsurf, Forge won't touch `.windsurf/`. Adding a new assistant is [one file](https://crucibledx.dev/forge/assistants).

## See It in Action

### Drift detection & easy updates

> Check status, spot drift, add a second source, sync — no YAML editing, no guessing.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/dark/02-easy-updates.gif">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/light/02-easy-updates.gif">
  <img alt="Forge CLI — easy updates" src="https://github.com/crucibledx/assets/raw/main/forge/demos/light/02-easy-updates.gif" width="720">
</picture>

### Power user: merge strategies & dry-run

> Fine-grained source control, include/exclude filters, conflict resolution, dry-run preview, health dashboard.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/dark/03-power-user.gif">
  <source media="(prefers-color-scheme: light)" srcset="https://github.com/crucibledx/assets/raw/main/forge/demos/light/03-power-user.gif">
  <img alt="Forge CLI — power user" src="https://github.com/crucibledx/assets/raw/main/forge/demos/light/03-power-user.gif" width="720">
</picture>

## Commands

| Command                   | Description                                            |
|---------------------------|--------------------------------------------------------|
| `forge init`              | Interactive wizard — detect tools, configure sources   |
| `forge sync`              | Fetch, transform, and place files for each assistant   |
| `forge sync --dry-run`    | Preview all changes without writing                    |
| `forge status`            | Show drift between last sync and filesystem            |
| `forge health`            | SLI dashboard — sync frequency, drift, reachability    |
| `forge config`            | Interactive config editor                              |
| `forge source list`       | List sources with sync counts                          |
| `forge source add`        | Add a source interactively                             |
| `forge source remove`     | Remove a source + optional cleanup                     |
| `forge source edit`       | Edit source with pre-filled values                     |
| `forge scheduler install` | Register OS-level auto-sync (launchd/crontab/schtasks) |
| `forge uninstall`         | Remove config, scheduler, and synced files             |

Full reference → [crucibledx.dev/forge/commands](https://crucibledx.dev/forge/commands)

## Sources

### Git (recommended)

```yaml
sources:
  - name: org-standards
    type: git
    url: git@github.com:acme/ai-configs.git
    branch: main
    subdirectory: skills     # optional: sync only a subfolder
    include: [ "*.md" ]        # optional: glob filters
```

### Local directory

```yaml
sources:
  - name: team-rules
    type: local
    path: ../shared-ai-configs
```

### Source layouts

Forge auto-detects how your source is organized — no configuration needed:

- **Canonical** — `skills/`, `rules/`, `workflows/` folders, distributed and transformed per assistant
- **Pre-structured** — contains `.claude/`, `.cursor/` dirs, copied as-is
- **Hybrid** — mix of both, auto-detected by default

## Sync Engine

- **Multi-source** — parallel fetch via `Promise.allSettled`, failed sources don't block others
- **SHA-256 change detection** — no unnecessary writes
- **Conflict strategies** — `prefer_source`, `prefer_local`, or `error` for both source and local conflicts
- **Backup** — `.bak` copies before overwrites
- **Dry-run** — preview everything before writing
- **Rollback** — on failure, already-written files are reverted. No partial state
- **Auto-sync** — OS-level scheduling: launchd (macOS), crontab (Linux), Task Scheduler (Windows)

## Best With a Skills Platform

Forge pulls from any git repo. But for teams building shared AI resources at scale, pair it with the [Forge Skills Starter](https://github.com/crucibledx/forge-skills-starter) — a convention-over-configuration platform for designing, developing, testing, and delivering AI skills, rules, and
workflows.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/platform/diagrams/dark/platform-structure.svg">
  <img alt="Platform Structure" src="https://github.com/crucibledx/assets/raw/main/platform/diagrams/light/platform-structure.svg">
</picture>

## Part of Crucible

Forge is the distribution engine of the [Crucible](https://crucibledx.dev) platform — an ecosystem of focused tools for AI developer experience.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/crucibledx/assets/raw/main/crucible/diagrams/dark/crucible-ecosystem.svg">
  <img alt="Crucible Ecosystem" src="https://github.com/crucibledx/assets/raw/main/crucible/diagrams/light/crucible-ecosystem.svg">
</picture>

## Development

```bash
bun install               # install deps
bun run dev -- <command>  # run locally
bun run test              # unit + e2e tests
bun run typecheck         # tsc --noEmit
bun run build             # compile to dist/
```

DDD architecture: `domain/` (pure logic) → `application/` (commands) → `infrastructure/` (I/O). Adding a new assistant or source type = one file, zero changes to existing commands.

## License

[MIT](LICENSE)
