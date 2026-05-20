# Forge CLI — v0.5 Architecture & Design

> **Milestone:** Forge v0.5 — "Smart Sources"
>
> **Prerequisite:** Forge v0.4 shipped (scheduler, auto-pilot).
>
> **Scope:** Pre-structured source support, source layout detection,
> passthrough mode for shared repos that already contain assistant-specific
> directory structures.

---

## Motivation

Currently, forge assumes a **canonical source layout**:

```
source/
  skills/
    deploy.md
  rules/
    api.md
```

The resolver maps `skills/**` and `rules/**` to each assistant's target
directories (`.claude/skills/`, `.cursor/rules/`, etc.) and applies
transforms along the way.

But teams may share repos that **already contain assistant-specific
directories**:

```
shared-rules/
  .claude/
    rules/
      api.md
  .windsurf/
    rules/
      api.md
  .cursor/
    rules/
      api.mdc
```

In this layout, transforms have already been applied by the author. Forge
should detect this and copy files **as-is** to the correct locations
without re-transforming.

---

## Source Layout Modes

### 1. Canonical (current — default)

Source has `skills/`, `rules/`, `workflows/` top-level folders. Forge
resolves targets per-assistant and applies the configured transform chain.

### 2. Pre-structured (new)

Source contains assistant-specific directories (`.claude/`, `.cursor/`,
`.windsurf/`, `.github/`, `.cline/`). Forge copies each directory
verbatim to the project root — no transforms applied.

### 3. Hybrid (future consideration)

Source has both canonical folders and assistant-specific overrides.
Canonical folders are resolved normally; assistant-specific directories
are copied verbatim, taking precedence over resolved files.

---

## Detection Strategy

```
detectSourceLayout(files: string[]): 'canonical' | 'pre-structured'
```

- Scan top-level directory names in the source.
- If **any** match a known assistant directory (`.claude`, `.cursor`,
  `.windsurf`, `.github`, `.cline`), classify as `pre-structured`.
- Otherwise, classify as `canonical`.
- Allow explicit override in source config:
  ```yaml
  sources:
    - name: team-rules
      type: git
      url: https://github.com/org/shared-rules.git
      layout: pre-structured  # or 'canonical' (default)
  ```

---

## Config Schema Changes

```yaml
# Source definition — v0.5 additions
sources:
  - name: team-rules
    type: git
    url: https://github.com/org/shared-rules.git
    layout: auto  # 'auto' | 'canonical' | 'pre-structured' (default: auto)
```

- `auto` — detect from source file tree (default).
- `canonical` — force standard layout, apply transforms.
- `pre-structured` — force passthrough, copy as-is.

---

## Implementation Plan

### Domain

- [ ] `domain/sync/layout.ts` — `detectSourceLayout()` + `SourceLayout` type
- [ ] Update `resolver.ts` — skip transform chain when layout is pre-structured
- [ ] Add `layout` field to `Source` type in `domain/config/types.ts`

### Infrastructure

- [ ] Update source loaders to pass layout info through `SourceLoadResult`
- [ ] Update config schema validation to accept `layout` field

### Application

- [ ] Update sync handler to respect layout detection
- [ ] Add layout info to sync plan display

### Testing

- [ ] Unit tests for `detectSourceLayout()`
- [ ] E2e: pre-structured source sync (local + git)
- [ ] E2e: explicit layout override in config

---

## Open Questions

1. **Nested assistant dirs in subdirectories** — Should `source/team-a/.claude/` be
   detected as pre-structured, or only top-level assistant dirs?
2. **Conflict resolution** — If pre-structured source has `.claude/rules/api.md` and
   canonical source has `rules/api.md`, which wins?
3. **Partial pre-structure** — If source has `.claude/` but not `.cursor/`, should forge
   resolve canonical rules for missing assistants?
4. **Transform bypass** — Should pre-structured files completely skip the transform
   pipeline, or pass through a no-op identity transform?

---

## Global Config — Fully Separated Scope

### Design Principle

Global and project configs are **completely independent scopes**. No merging,
no inheritance, no precedence rules. Each scope owns its own config, sources,
assistants, and sync target.

| Scope   | Config file                     | Sync target | Flag        |
|---------|---------------------------------|-------------|-------------|
| Project | `.crucible/forge.config.yaml`   | `./`        | _(default)_ |
| Global  | `~/.crucible/forge.config.yaml` | `~/`        | `--global`  |

This works because AI assistants already support both scopes natively:

| Assistant   | Project rules           | Global rules              |
|-------------|-------------------------|---------------------------|
| Claude Code | `.claude/rules/`        | `~/.claude/rules/`        |
| Cursor      | `.cursor/rules/`        | `~/.cursor/rules/`        |
| Windsurf    | `.windsurf/rules/`      | `~/.windsurf/rules/`      |
| Copilot     | `.github/instructions/` | `~/.github/instructions/` |

### How It Works

The entire sync pipeline stays unchanged — only `projectRoot` differs:

- `forge sync` → `projectRoot = cwd` → syncs to `.claude/`, `.cursor/`, etc.
- `forge sync --global` → `projectRoot = ~` → syncs to `~/.claude/`, `~/.cursor/`, etc.

Assistant `targetMappings` are relative paths (`.claude/skills/`), so they
resolve correctly in both scopes with zero changes to assistant definitions.

### Commands with `--global`

Every command gains a `--global` flag:

```
forge init --global        # scans ~/ for assistants, writes ~/.crucible/forge.config.yaml
forge config --global      # edits global config
forge sync --global        # syncs global sources to ~/
forge sync --global --dry-run
```

### Config Schema

Both scopes use the **exact same schema** — no `scope` field, no `defaults`
block, no special keys:

```yaml
# ~/.crucible/forge.config.yaml — global config
version: "1"
assistants:
  - id: claude-code
    enabled: true
  - id: cursor
    enabled: true
sources:
  - name: my-personal-rules
    type: git
    url: https://github.com/me/ai-rules.git
```

```yaml
# .crucible/forge.config.yaml — project config (unchanged)
version: "1"
assistants:
  - id: claude-code
    enabled: true
sources:
  - name: team-rules
    type: git
    url: https://github.com/org/shared-rules.git
```

### Implementation Notes

- `io.resolveProjectRoot()` currently finds the nearest `.crucible/` dir
  walking upward. With `--global`, it returns `os.homedir()` instead.
- Remove `mergeConfigs()` — each scope loads exactly one config file.
- Add `--global` as a shared `CommandOption` available on all commands.
- `configFilePath()` and `crucibleDirPath()` accept a root parameter
  (already do) — no changes needed.

### What This Eliminates

- No merge logic, no precedence confusion
- No `scope` field on sources
- No "where did this rule come from?" debugging
- No `--no-global` flag needed

---

## Future Ideas

_Items below are not committed to v0.5 but captured for consideration._

- **Source composition** — Multiple sources with different layouts merged into a
  single sync plan
- **Source validation** — Warn when pre-structured source contains files for
  assistants not enabled in config
- **Source scaffolding** — `forge source init` to generate a canonical or
  pre-structured source template
