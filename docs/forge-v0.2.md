# Forge CLI — v0.2 Architecture & Design

> **Milestone:** Forge v0.2 — "Config Control"
>
> **Prerequisite:** Forge v0.1 shipped (v0.1.9).
>
> **Scope:** Multi-source support, interactive `forge config` command with
> registry-driven section editors, rules frontmatter translation.

---

## What Changes From v0.1

### New user-facing command

| Command        | What it solves                                              |
|----------------|-------------------------------------------------------------|
| `forge config` | Interactive config editor — pick a section, change it, save |

### Init wizard improvements

- **Multiple sources** — "Add another source?" loop after each source is configured.
  Sources listed in add-order. Sort/reorder deferred to v0.3.

### What was dropped from earlier v0.2 plans

| Dropped                              | Reason                                                          |
|--------------------------------------|-----------------------------------------------------------------|
| `forge config set <path> <val>`      | Users can edit YAML directly for targeted one-offs              |
| `forge config show`                  | `cat .crucible/forge.config.yaml` is sufficient for now         |
| `forge config diff` / `promote`      | No config layers = no promotion needed                          |
| `forge update`                       | `forge config` replaces it (same UX, one less command to learn) |
| Config layers (local/project/global) | Just project config for now. `--global` flag deferred           |

---

## Config: Multiple Sources

The v0.1 `source:` (singular) field becomes `sources:` (plural).

Migration: if `source:` exists and `sources:` does not, the CLI auto-wraps it into a
single-element `sources:` list. No user action needed.

```yaml
# .crucible/forge.config.yaml — v0.2

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

## `forge config` — Interactive Config Editor

A **registry-driven select loop**. The command is a generic shell; each config section
is a self-contained editor. Adding a new section (e.g. scheduler, plugins) requires only
creating a new file and pushing it to the registry — zero handler changes.

### UX Flow

```
$ forge config

┌  Forge — Edit Configuration
│
◆  What would you like to change?
│  ○ Assistants  (2 enabled: claude-code, windsurf)
│  ○ Sources  (2 configured: team-backend, company-wide)
└

  # → user picks Assistants → section-specific prompts run
  # → returns updated config

◇  Assistants updated: claude-code, cursor, windsurf
│
◆  Change something else?
│  ● Yes → back to select
│  ○ No  → save and exit
└

◇  Saved .crucible/forge.config.yaml
```

### Section Editor Interface

```ts
interface ConfigSectionEntry {
    id: string
    label: string
    hint: (config: ForgeConfig) => string   // summary shown in select
    edit: (config: ForgeConfig) => Promise<ForgeConfig>
}
```

Each editor:

- Receives the full current config
- Runs its own prompts (detection, multiselect, text, confirm, etc.)
- Returns the full updated config
- The handler merges nothing — it just passes through

### Section Editors

**Assistants** — `sections/assistants.ts`

1. Run `scanForAssistants()` (same scanner as init)
2. Show multiselect — detected ones hinted, currently-enabled ones pre-selected
3. Warn if 0 selected
4. Return config with updated `assistants` array

**Sources** — `sections/source.ts`

1. List current sources with summary
2. Options: edit existing / add new / remove
3. Edit: show current values, re-run `loader.configure()` for that type
4. Add: source type select → `loader.configure()` → verify
5. Remove: confirm → remove from array
6. Return config with updated `sources` array

---

## Init Wizard — Updated UX

### Multi-source loop

```
  Add a source? › Yes

  Source type:
  › Git (SSH / HTTPS)
    Local directory

  Source git URL: git@github.com:acme/ai-configs.git
  Branch: main
  Subdirectory (optional):
  ◌ Verifying source is reachable...
  ✓ Source verified

  Add another source? › Yes
    Source type: › Local directory
    Path: ~/my-personal-ai-configs/

  Add another source? › No
```

---

## Internal Architecture

```
forge-cli/src/
  application/commands/
    config/
      index.ts              — CommandDefinition
      handler.ts            — generic loop: load → select section → delegate → repeat? → save
      messages.ts           — top-level messages (intro, outro, select prompt, etc.)
      sections/
        types.ts            — ConfigSectionEntry interface
        index.ts            — registry: sections[] array
        assistants.ts       — detection + multiselect, pre-selects current enabled
        source.ts           — list/add/edit/remove sources, reuses loader.configure()
```

### Shared Prompt Extraction

The init handler currently has assistant selection and source configuration inline.
Both `init` and `config` need the same prompts. Extract to shared location:

```
application/commands/
  shared/
    assistant.prompt.ts     — detection + multiselect (used by init + config assistants section)
    source.prompt.ts        — type select + loader.configure() + verify (used by init + config source section)
```

Init handler becomes thin: calls shared prompts, writes config.

### Dependency Flow

```
config/handler.ts
  → sections/index.ts (registry)
    → sections/assistants.ts
      → @infrastructure/fs/scanner (detection)
      → @infrastructure/cli/prompts (multiselect)
      → @domain/assistants (registry)
    → sections/source.ts
      → @infrastructure/source (loader.configure, verify)
      → @infrastructure/cli/prompts (select, confirm)
  → @infrastructure/config (load, write)
```

All arrows flow inward: application → infrastructure, application → domain. ✅

---

## Rules Frontmatter Translation

v0.1 syncs rules as plain Markdown (no frontmatter). v0.2 adds a translation layer
for path-scoped rules:

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

## Implementation Order

| #  | Step                                             | Scope                              |
|----|--------------------------------------------------|------------------------------------|
| 1  | Multi-sources: domain types + schema + migration | `domain/config/`                   |
| 2  | Multi-sources: init handler "add another?" loop  | `init/handler.ts`, `messages.ts`   |
| 3  | Multi-sources: sync handler iterates sources     | `sync/handler.ts`                  |
| 4  | `ConfigSectionEntry` interface + registry        | `config/sections/`                 |
| 5  | `forge config` handler — generic select loop     | `config/handler.ts`, `messages.ts` |
| 6  | Assistants section editor                        | `config/sections/assistants.ts`    |
| 7  | Source section editor                            | `config/sections/source.ts`        |
| 8  | Extract shared prompts from init                 | `shared/`                          |
| 9  | Rules frontmatter translation                    | `domain/sync/`, `infrastructure/`  |
| 10 | Tests + e2e                                      | throughout                         |

---

*Document version: 0.2.1 — updated 2026-05-13*
*Prerequisite: forge v0.1 shipped (v0.1.9)*
*Scope: multi-source, interactive forge config, rules frontmatter translation*
*Next: see forge-v0.3.md (sync v2, merge engine, forge status)*
