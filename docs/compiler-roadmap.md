# Forge — Compiler Roadmap

> The evolution from file copier to context compiler.

## The Big Picture

Forge today is a **file copier with transforms** — it fetches files, maps globs to agent directories, applies rename/frontmatter transforms, and writes. This is functionally the same as agentskills.io, agent-skills-cli, and every other tool with different UX.

The differentiation: evolve Forge into a **context compiler**. A build pipeline that understands skill dependencies, tree-shakes unused content, optimizes output per agent, and produces compiled context bundles with manifests. Nobody does this.

> "Other tools install files. Forge compiles your AI environment."

## The Vite Analogy

| Vite concept                                   | Forge compiler equivalent                              |
|------------------------------------------------|--------------------------------------------------------|
| **ES modules** (source format)                 | Canonical skill files (`.md` with frontmatter)         |
| **import statements** (dependency declaration) | `depends:` frontmatter field linking skills            |
| **Tree-shaking** (dead code elimination)       | Remove skills not relevant to project context          |
| **Code-splitting** (chunked output)            | Split large skill bundles into priority-ordered chunks |
| **Build targets** (browser compat)             | Per-agent output optimization                          |
| **HMR** (hot module replacement)               | Incremental re-compile on skill source change          |
| **Plugins** (build pipeline extensions)        | Transform pipeline (already exists)                    |

## Pipeline Evolution

### Current pipeline (v0.6)

```
Source.load() → collectFiles() → applySourceFilters(include/exclude/map)
  → resolveTargets(layout → canonical/pre-structured/hybrid)
    → applyTransforms(rename, frontmatter-rename)
      → buildPlan(diff, conflicts) → applyMutations() → writeSyncState()
```

### Compiler pipeline (v0.8+)

```
Source.load() → collectFiles() → applySourceFilters()
  → PARSE(frontmatter → SkillGraph)                              ← v0.8
    → ANALYZE(dependencies, context, priorities)                  ← v0.9-v0.10
      → OPTIMIZE(tree-shake, deduplicate, budget)                 ← v0.10-v0.11
        → EMIT(per-agent output + manifest)                       ← v0.12-v0.13
          → buildPlan() → applyMutations() → writeSyncState()
```

Four new stages inserted. Output type is still `ResolvedTarget[]` — everything downstream is unchanged.

## Version Plan

Each compiler feature is a standalone version — room for patch releases within each:

| Version                 | Feature                                  | Effort    | Depends on            |
|-------------------------|------------------------------------------|-----------|-----------------------|
| [v0.7](forge-v0.7.md)   | Smithery/agentskills.io source adapter   | 2-3 days  | Nothing (independent) |
| [v0.8](forge-v0.8.md)   | Skill frontmatter schema + parser        | 1 week    | Nothing               |
| [v0.9](forge-v0.9.md)   | Skill graph + dependency resolution      | 1-2 weeks | v0.8                  |
| [v0.10](forge-v0.10.md) | Project context detection + tree-shaking | 2 weeks   | v0.9                  |
| [v0.11](forge-v0.11.md) | Token budgeting + priority ordering      | 1 week    | v0.9                  |
| [v0.12](forge-v0.12.md) | Per-agent emitters (compile targets)     | 2-3 weeks | v0.11                 |
| [v0.13](forge-v0.13.md) | Manifest generation (Ember bridge)       | 1 week    | v0.12                 |

**Future versions** (not yet specced):

- **v0.14+** — Code-splitting (chunked output for large skill bundles)
- **v0.15+** — Incremental compilation (HMR-style re-compile on source change)
- **v0.16+** — Plugin API expansion (custom compiler stages)
- **v1.0** — Stable compiler with all Vite-analogy features complete

**Total estimated effort**: 8-10 weeks for v0.7-v0.13.

## Backward Compatibility

**Zero breaking changes.** The compiler is additive:

- Files without frontmatter = leaf nodes with default priority. Today's behavior preserved.
- Sources without `compile: true` use the existing resolver. No forced migration.
- The existing transform system (`rename`, `frontmatter-rename`) is untouched.
- The `forge.config.yaml` schema is extended, not changed.

## Config Extension

```yaml
# Existing fields unchanged
sources:
  - name: team-skills
    type: git
    url: git@github.com:team/skills.git

# New optional section (v0.10+)
compile:
  enabled: true
  context:
    languages: [ java, kotlin ]
    frameworks: [ spring ]
  budgets:
    claude-code: 15000
    cursor: 10000
```

When `compile.enabled` is absent or false, Forge behaves exactly as v0.6.

## Architecture

All compiler logic lives in `domain/compiler/` — pure functions, no I/O:

```
domain/
  compiler/
    types.ts              — SkillNode, SkillGraph, OptimizedBundle
    parser.ts             — Frontmatter extraction (v0.8)
    graph.ts              — DAG construction, cycle detection, topo sort (v0.9)
    context.ts            — Project context matching (v0.10)
    optimizer.ts          — Tree-shaking, budgeting, ordering (v0.10-v0.11)
    tokens.ts             — Token estimation (v0.11)
    emitter.ts            — Per-agent emit orchestration (v0.12)
    emitters/             — Dir-per-agent (horizontal scaling)
      claude-code.ts
      cursor.ts
      copilot.ts
      windsurf.ts
      cline.ts
    manifest.ts           — Manifest generation (v0.13)
    index.ts              — Barrel

infrastructure/
  source/
    smithery/             — Smithery source loader (v0.7)
```

## Sequencing

Build in order — each feature builds on the previous:

1. **Smithery adapter** (v0.7) — independent, ship first as distribution win
2. **Parser** (v0.8) — must exist before any compiler logic
3. **Graph** (v0.9) — needs parser output
4. **Context + tree-shaking** (v0.10) — needs graph
5. **Token budgeting** (v0.11) — needs graph + priorities
6. **Emitters** (v0.12) — needs optimized output
7. **Manifest** (v0.13) — needs emitter output
