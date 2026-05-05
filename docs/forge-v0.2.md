# Forge CLI — v0.2 Architecture & Design

> **Milestone:** Forge v0.2 — "Config Control"
>
> **Prerequisite:** Forge v0.1 shipped.
>
> **Scope:** Config management CLI (`forge config`), `forge update` wizard,
> multi-source support in `forge init`, multiselect for assistant selection.

---

## What Changes From v0.1

### New user-facing commands

| Command                | What it solves                                            |
|------------------------|-----------------------------------------------------------|
| `forge config set`     | Targeted config change saved to local layer first         |
| `forge config show`    | View effective config (merged: global + project + local)  |
| `forge config diff`    | Show what differs between config layers                   |
| `forge config promote` | Promote local change up to project or global layer        |
| `forge update`         | Re-run the init wizard pre-populated with existing values |

### Init wizard improvements

- **Multiselect for assistants** — single `multiselect` prompt replaces the per-assistant yes/no loop.
  Detected assistants are pre-selected; undetected ones are unchecked.
- **Multiple sources** — "Add another source?" loop after each source is configured.
  Sources listed in add-order (highest priority first). Sort/reorder deferred to v0.3.

---

## Config: Multiple Sources

The v0.1 `source:` (singular) field becomes `sources:` (plural).
Migration: if `source:` exists and `sources:` does not, the CLI auto-wraps it into a
single-element `sources:` list. No user action needed.

```yaml
# .crucible/forge.config.yaml — v0.2 additions

# ── Sources (replaces v0.1 singular `source:`) ──────────────────
# Listed in priority order (highest first)
sources:
  - name: local-overrides
    type: local
    path: ~/my-personal-ai-configs/

  - name: team-backend
    type: git
    url: git@ssh.dev.azure.com:v3/acme/eng/backend-team-ai.git
    branch: main
    path: shared/

  - name: company-wide
    type: git
    url: git@github.com:acme/ai-configs.git
    branch: main
    path: skills/
```

---

## Config Promotion Workflow

Changes start in the local layer, then can be promoted toward the team.

### Three config layers

| Layer       | File                                | Shared?                                |
|-------------|-------------------------------------|----------------------------------------|
| **Local**   | `.crucible/forge.config.local.yaml` | No (gitignored) — personal overrides   |
| **Project** | `.crucible/forge.config.yaml`       | Yes (committed) — team config          |
| **Global**  | `~/.crucible/forge.config.yaml`     | No — user defaults across all projects |

### CLI commands

```bash
# Targeted change saved to local config first
forge config set sources.team-backend.branch develop

# View effective merged config
forge config show

# See what local layer overrides vs project
forge config diff

# Promote a local change to project config (team-visible)
forge config promote --to project sources.team-backend.branch

# Promote a project setting to global
forge config promote --to global defaults.assistants
```

When a config section has multiple items, the CLI identifies by `name`:

```bash
forge config set sources.team-backend.branch develop
# ↑ identifies source by name "team-backend", changes its branch
```

**DX goal:** users never *have* to edit YAML manually. `forge init` handles initial setup,
`forge config set/promote` handles ongoing changes. YAML exists for power users and version control review.

---

## `forge update`

Re-runs the init wizard with existing config pre-populated. The user sees their current
choices and can change any of them. Writes directly to project config (no local/promote
intermediary — the user is consciously choosing to update the shared config).

```
$ forge update

  ┌─────────────────────────────────────────────┐
  │  Forge — Update Configuration               │
  └─────────────────────────────────────────────┘

  Loading existing config from .crucible/forge.config.yaml...

  Which assistants to enable?
  ◉ Claude Code (detected)
  ◉ Cursor (detected)
  ○ Windsurf
  ◉ Copilot
  ○ Cline

  Sources (currently 1):
  Edit company-wide? › No
  Add another source? › Yes
    Source type: › Git (SSH / HTTPS)
    URL: git@ssh.dev.azure.com:v3/acme/eng/backend-team-ai.git
    ...

  ✓ Config updated: .crucible/forge.config.yaml
```

---

## Init Wizard — Updated UX

### Assistant multiselect

```
  Which AI assistants to enable?
  ◉ Claude Code    (detected — .claude/ found)
  ◉ Cursor         (detected — .cursor/rules/, 3 rules)
  ○ Windsurf
  ○ Copilot
  ○ Cline
```

### Multi-source loop

```
  Add a shared skills source? › Yes

  Source type:
  › Git (SSH / HTTPS)
    Local directory

  Source git URL: git@github.com:acme/ai-configs.git
  Branch: main
  Subdirectory (optional):

  Add another source? › Yes
    Source type: › Local directory
    Path: ~/my-personal-ai-configs/

  Add another source? › No
```

---

## Internal Architecture Additions

```
forge-cli/
  src/
    application/commands/
      update/index.ts + handler.ts   # re-run init wizard pre-populated
      config/index.ts + handler.ts   # set / show / diff / promote subcommands
```

---

## Rules Frontmatter Translation (v0.2)

v0.1 syncs rules as plain Markdown (no frontmatter). v0.2 adds a translation layer for path-scoped rules:

```yaml
# Source rule (canonical format — `paths` key, same as Claude Code/Cline)
---
paths:
  - "src/api/**/*.ts"
---
All endpoints must include input validation.
```

Translation during sync:

| Target      | Frontmatter key | Transform                                         |
|-------------|-----------------|---------------------------------------------------|
| Claude Code | `paths`         | No change (canonical)                             |
| Cline       | `paths`         | No change                                         |
| Windsurf    | `globs`         | Rename key                                        |
| Cursor      | `globs`         | Rename key + `.md` → `.mdc` extension             |
| Copilot     | `applyTo`       | Rename key + `.md` → `.instructions.md` extension |

---

*Document version: 0.2 — pre-implementation*
*Prerequisite: forge v0.1 shipped*
*Scope: config management, forge update, multi-source init, assistant multiselect*
*Next: see forge-v0.3.md (sync v2, merge engine, forge status)*
