# Forge v0.7.5 — Per-Agent Emitters (Compile Targets)

> **Feature:** Generate optimized output per agent — each agent gets skills in its native format, optimized for how it discovers and loads context.
>
> **Depends on:** v0.7.4 (optimized, ordered skill list).
>
> **Effort:** ~2-3 weeks (1-2 weeks for Claude Code + framework, then incremental per agent).

---

## Problem

Today, Forge places the same content in different locations per agent (via `targetMappings`). But each agent discovers and loads context differently. Claude Code reads individual skill files alphabetically. Cursor loads all `.mdc` rules at once. Copilot reads flat `.instructions.md`. Optimizing output format per agent significantly improves how well the agent utilizes the compiled skills.

## Solution

Each agent gets a dedicated **emitter** — a function that takes the optimized skill list and generates output files in the agent's preferred format. Emitters follow the same dir-per-entry horizontal scaling pattern as assistants and source loaders.

## Agent-Specific Strategies

| Agent | Native format | Emit strategy |
|-------|--------------|---------------|
| **Claude Code** | Individual `.md` files in `.claude/skills/` | One file per skill. Prefix with priority rank (`001-study-java.md`) for alphabetical priority |
| **Cursor** | `.mdc` rule files in `.cursor/rules/` | Merge related skills into combined rule files. Cursor loads all rules — fewer, larger files reduce discovery overhead |
| **Copilot** | `.instructions.md` in `.github/copilot-instructions/` | Flat merged content. Copilot instructions are simple — merge and deduplicate aggressively |
| **Windsurf** | `.windsurfrules` or `.windsurf/rules/` | Combined rules format, similar to Cursor |
| **Cline** | `.clinerules` or `.cline/rules/` | Combined rules, merged content |

## Types

```typescript
// domain/compiler/types.ts (extends previous)

interface EmitResult {
  targets: ResolvedTarget[]    // same type as existing resolver output
  stats: EmitStats
}

interface EmitStats {
  agent: string
  filesEmitted: number
  totalTokens: number
  skillsMerged: number         // skills that were merged into combined files
}

// domain/compiler/emitters/types.ts

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

Same pattern as assistants and source loaders — self-registering:

```typescript
// domain/compiler/emitters/registry.ts
export const emittersRegistry: AgentEmitter[] = []
```

Each emitter file pushes to the registry on import. Adding a new agent emitter = one file + registry push.

## Claude Code Emitter (reference implementation)

```typescript
// domain/compiler/emitters/claude-code.ts

function emitClaudeCode(skills: SkillNode[], options: EmitOptions): EmitResult {
  const targets: ResolvedTarget[] = skills.map((skill, index) => {
    const rank = String(index + 1).padStart(3, '0')
    const filename = `${rank}-${skill.id}.md`
    return {
      sourcePath: skill.path,
      targetPath: `.claude/skills/${filename}`,
      content: skill.bodyContent,  // emit body only, frontmatter is metadata
      assistantId: 'claude-code',
      sourceName: options.sourceName,
    }
  })

  return {
    targets,
    stats: {
      agent: 'claude-code',
      filesEmitted: targets.length,
      totalTokens: skills.reduce((sum, s) => sum + estimateTokens(s.bodyContent), 0),
      skillsMerged: 0,
    },
  }
}
```

## Cursor Emitter (merge strategy)

```typescript
// domain/compiler/emitters/cursor.ts

function emitCursor(skills: SkillNode[], options: EmitOptions): EmitResult {
  // Group skills by primary tag (e.g., all "java" skills into java-rules.mdc)
  const groups = groupBy(skills, s => s.frontmatter.tags?.[0] ?? 'general')

  const targets: ResolvedTarget[] = Object.entries(groups).map(([tag, groupSkills]) => {
    const content = groupSkills
      .map(s => `## ${s.frontmatter.name ?? s.id}\n\n${s.bodyContent}`)
      .join('\n\n---\n\n')

    return {
      sourcePath: groupSkills[0].path,
      targetPath: `.cursor/rules/${tag}-rules.mdc`,
      content: buildMdcContent(tag, content),
      assistantId: 'cursor',
      sourceName: options.sourceName,
    }
  })

  return {
    targets,
    stats: {
      agent: 'cursor',
      filesEmitted: targets.length,
      totalTokens: skills.reduce((sum, s) => sum + estimateTokens(s.bodyContent), 0),
      skillsMerged: skills.length - targets.length,
    },
  }
}
```

## Integration with Existing Pipeline

The emitter's output is `ResolvedTarget[]` — the same type the existing `buildPlan()` / `applyMutations()` pipeline consumes. No changes to the downstream execution flow.

```typescript
// Modified fetchAndResolve flow (conceptual)

if (compileEnabled) {
  const parsed = sourceFiles.map(parseSkillFile)
  const { graph } = buildSkillGraph(parsed)
  const context = await detectProjectContext(projectRoot, config.compile?.context)
  const { kept } = treeShake(graph, context)
  const ordered = orderSkills(graph, kept)

  // Emit per-agent
  for (const assistant of assistants) {
    const emitter = getEmitter(assistant.id)
    const budgeted = applyBudget(ordered, config.compile?.budgets?.[assistant.id])
    const { targets } = emitter.emit(budgeted.included, { sourceName })
    allResolved.push(...targets)
  }
} else {
  // Existing resolver (unchanged)
  allResolved.push(...resolveTargets(sourceFiles, assistants, sourceName))
}
```

## Fallback

If no emitter is registered for an agent, fall back to the existing `resolveTargets()` resolver. This ensures new/unknown agents work even without a custom emitter.

## File Location

```
domain/compiler/
  emitter.ts                — orchestrates per-agent emission, fallback logic
  emitters/
    types.ts                — AgentEmitter, EmitResult, EmitOptions
    registry.ts             — emittersRegistry
    claude-code.ts          — Claude Code emitter
    cursor.ts               — Cursor emitter
    copilot.ts              — GitHub Copilot emitter
    windsurf.ts             — Windsurf emitter
    cline.ts                — Cline emitter
```

## Tests

- Claude Code: N skills → N files with priority-prefixed names
- Cursor: N skills → grouped `.mdc` files by tag
- Copilot: N skills → merged `.instructions.md` files
- Fallback: unknown agent → uses existing resolveTargets()
- Empty skill list → empty targets
- Skills with no tags → all go to "general" group in merging emitters
- Output type matches ResolvedTarget[] (integration with existing pipeline)

## Adding a New Emitter

Same horizontal scaling pattern:

1. Create `domain/compiler/emitters/<agent-name>.ts`
2. Implement `AgentEmitter` interface
3. Push to `emittersRegistry`
4. Zero changes to any command handler or existing emitters
