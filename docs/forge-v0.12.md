# Forge v0.12 — Per-Agent Emitters (Compile Targets)

> **Milestone:** Forge v0.12 — "Compile Targets"
>
> **Prerequisite:** Forge v0.11 (optimized, ordered skill list).
>
> **Scope:** Generate optimized output per agent. Each agent gets skills in its
> native format, optimized for how it discovers and loads context. This is the
> "build targets" equivalent from the Vite analogy.
>
> **Effort:** ~2-3 weeks (framework + Claude Code first, then incremental per agent).

---

## Problem

Today, Forge places the same content in different locations per agent (via `targetMappings`). But each agent discovers and loads context differently. Claude Code reads individual skill files alphabetically. Cursor loads all `.mdc` rules at once. Copilot reads flat `.instructions.md`. Optimizing output format per agent significantly improves skill utilization.

## Solution

Each agent gets a dedicated **emitter** — a function that takes the optimized skill list and generates output files in the agent's preferred format. Emitters follow the dir-per-entry horizontal scaling pattern.

## Agent-Specific Strategies

| Agent | Native format | Emit strategy |
|-------|--------------|---------------|
| **Claude Code** | Individual `.md` in `.claude/skills/` | One file per skill, priority-prefixed (`001-study-java.md`) |
| **Cursor** | `.mdc` in `.cursor/rules/` | Merge related skills by tag into combined rule files |
| **Copilot** | `.instructions.md` in `.github/copilot-instructions/` | Flat merged content, aggressive deduplication |
| **Windsurf** | `.windsurf/rules/` | Combined rules format, similar to Cursor |
| **Cline** | `.cline/rules/` | Combined rules, merged content |

## Types

```typescript
interface EmitResult {
  targets: ResolvedTarget[]    // same type as existing resolver output
  stats: EmitStats
}

interface EmitStats {
  agent: string
  filesEmitted: number
  totalTokens: number
  skillsMerged: number
}

interface AgentEmitter {
  agentId: string
  emit: (skills: SkillNode[], options: EmitOptions) => EmitResult
}

interface EmitOptions {
  sourceName: string
  budget?: number
}
```

## Emitter Registry

Same horizontal scaling pattern as assistants and source loaders:

```typescript
export const emittersRegistry: AgentEmitter[] = []
```

Adding a new agent emitter = one file + registry push. Zero changes to handlers.

## Integration with Existing Pipeline

The emitter's output is `ResolvedTarget[]` — the same type the existing `buildPlan()` / `applyMutations()` pipeline consumes. No changes downstream.

```typescript
if (compileEnabled) {
  // ... parse, graph, tree-shake, budget ...
  for (const assistant of assistants) {
    const emitter = getEmitter(assistant.id)
    const { targets } = emitter.emit(budgeted.included, { sourceName })
    allResolved.push(...targets)
  }
} else {
  // Existing resolver (unchanged)
  allResolved.push(...resolveTargets(sourceFiles, assistants, sourceName))
}
```

## Fallback

If no emitter is registered for an agent, fall back to `resolveTargets()`. New/unknown agents work without a custom emitter.

## File Location

```
domain/compiler/
  emitter.ts                — orchestrates per-agent emission, fallback logic
  emitters/
    types.ts                — AgentEmitter, EmitResult, EmitOptions
    registry.ts             — emittersRegistry
    claude-code.ts
    cursor.ts
    copilot.ts
    windsurf.ts
    cline.ts
```

## Tests

- Claude Code: N skills → N files with priority-prefixed names
- Cursor: N skills → grouped `.mdc` files by tag
- Copilot: N skills → merged `.instructions.md`
- Fallback: unknown agent → uses existing resolveTargets()
- Empty skill list → empty targets
- Output type matches ResolvedTarget[] (integration test)
