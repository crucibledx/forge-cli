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

## Future Ideas

_Items below are not committed to v0.5 but captured for consideration._

- **Source composition** — Multiple sources with different layouts merged into a
  single sync plan
- **Source validation** — Warn when pre-structured source contains files for
  assistants not enabled in config
- **Source scaffolding** — `forge source init` to generate a canonical or
  pre-structured source template
