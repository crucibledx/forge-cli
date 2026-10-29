# Forge v0.7 — Smithery / agentskills.io Source Adapter

> **Milestone:** Forge v0.7 — "Community Skills"
>
> **Prerequisite:** Forge v0.6.24 (production-ready, shipped).
>
> **Scope:** Add a source loader for Smithery/dot-agents registries, letting Forge
> pull skills from the 25k-star agentskills.io ecosystem.
>
> **Effort:** ~2-3 days.

---

## Problem

agentskills.io / Smithery has 25k GitHub stars and a large community of shared AI skills. Forge has zero community traction. Integrating with their ecosystem gives Forge users access to community skills and gives Forge visibility in that community.

## Solution

Add a `smithery` source loader following the existing source loader pattern (`source/git/`, `source/local/`). The loader clones/fetches from a dot-agents-compatible repository and normalizes the skill format into Forge's `SourceFile[]`.

## dot-agents Convention

Smithery skills follow a convention:

```
.agents/
  skills/
    my-skill/
      SKILL.md            — the skill content
      metadata.yaml       — name, description, tags, agent compatibility
```

Some repos use a flatter structure:

```
skills/
  my-skill.md             — skill with frontmatter metadata
```

The loader needs to handle both conventions.

## Implementation

```typescript
// infrastructure/source/smithery/loader.ts

const smitheryLoader: SourceLoaderEntry = {
  alias: 'smithery',
  label: 'Smithery / agentskills.io',
  configSchema: smitheryConfigSchema,
  configure: async (existing?: Source) => {
    // Prompt for registry URL (default: agentskills.io main repo)
    // Prompt for optional skill filter (which skills to pull)
    // Return Source config
  },
  load: async (source: Source) => {
    // Clone/fetch the repository (reuse git loader's clone logic)
    // Normalize dot-agents structure to Forge SourceFile[]
    // Return SourceLoadResult
  },
}
```

## Normalization

The loader converts dot-agents format to Forge's expected structure:

| dot-agents | Forge equivalent |
|------------|-----------------|
| `.agents/skills/my-skill/SKILL.md` | `skills/my-skill.md` |
| `.agents/skills/my-skill/metadata.yaml` | Merged into frontmatter |
| `skills/my-skill.md` | `skills/my-skill.md` (passthrough) |

If a `metadata.yaml` exists alongside `SKILL.md`, the loader merges it into YAML frontmatter so the compiler pipeline (v0.8+) can parse it.

## Config

```yaml
sources:
  - name: community
    type: smithery
    url: https://github.com/anthropics/dot-agents.git
    # Optional: filter specific skills
    skills:
      - study-java
      - review-python
    # Optional: specific branch/tag
    ref: main
```

## Types

```typescript
// infrastructure/source/smithery/types.ts

interface SmitherySourceConfig {
  url: string
  ref?: string
  skills?: string[]    // optional filter — only pull these skill IDs
}
```

## File Location

```
infrastructure/source/smithery/
  loader.ts        — SourceLoaderEntry implementation
  messages.ts      — CLI prompt messages
  types.ts         — SmitherySourceConfig
  index.ts         — barrel + registry push
  loader.test.ts   — tests
```

## Distribution Play

Once this ships:

1. **PR to agentskills.io** — "Forge now supports dot-agents as a source type" with usage example
2. **Blog post / README update** — "Use 25k+ community skills with Forge"
3. **Show compiler value** — "Pull community skills, Forge compiles them into optimized per-agent bundles" (once v0.8+ ships)

## Tests

- Configure with default URL → valid Source config
- Load from mock dot-agents repo → files normalized to Forge SourceFile[]
- `metadata.yaml` merged into frontmatter
- Flat structure (no `.agents/` dir) → passthrough
- Skill filter → only specified skills returned
- Empty repo → empty SourceFile[], no error
- Invalid URL → appropriate error

## Why Ship First

This has **zero dependencies** on the compiler pipeline. It works with today's Forge (v0.6) — skills are loaded as SourceFile[] and processed by the existing resolver. When the compiler ships (v0.8+), Smithery skills automatically gain compiler benefits.

**Cheapest distribution win** (2-3 days) and can go out immediately.
