# Forge v0.9 — Skill Graph + Dependency Resolution

> **Milestone:** Forge v0.9 — "Skill Graph"
>
> **Prerequisite:** Forge v0.8 (parser).
>
> **Scope:** Build a directed acyclic graph (DAG) from parsed skill nodes, resolve
> dependencies, detect cycles. This enables topological ordering, transitive
> dependency resolution, and orphan detection.
>
> **Effort:** ~1-2 weeks.

---

## Problem

Skills have implicit dependencies today — a `/review-java` skill assumes `/study-java` has already provided project context. These relationships are invisible and fragile. The graph makes them explicit and exploitable.

## Solution

Build a `SkillGraph` from parsed `SkillNode[]`. Edges come from the `depends` frontmatter field. The graph enables:

- Topological ordering (dependencies before dependents)
- Cycle detection (error on circular deps)
- Transitive dependency resolution (skill A → B → C)
- Orphan detection (unresolved references)

## Types

```typescript
// domain/compiler/types.ts (extends v0.8)

interface SkillGraph {
  nodes: Map<string, SkillNode>
  edges: Map<string, Set<string>>       // id → set of dependency ids
  dependents: Map<string, Set<string>>  // id → set of ids that depend on this
  rootIds: Set<string>                  // nodes with no dependents (entry points)
  leafIds: Set<string>                  // nodes with no dependencies
  orphanEdges: OrphanEdge[]             // unresolved references
}

interface OrphanEdge {
  from: string    // skill that declares the dependency
  to: string      // dependency ID that doesn't exist in any source
}

interface GraphBuildResult {
  graph: SkillGraph
  warnings: GraphWarning[]
}

type GraphWarning =
  | { type: 'orphan_dependency'; skillId: string; missingDep: string }
  | { type: 'duplicate_id'; skillId: string; paths: string[] }
```

## Implementation

```typescript
// domain/compiler/graph.ts

function buildSkillGraph(nodes: SkillNode[]): GraphBuildResult
function topologicalSort(graph: SkillGraph): string[]
function detectCycles(graph: SkillGraph): string[][] // returns cycle paths
function getTransitiveDeps(graph: SkillGraph, skillId: string): Set<string>
```

- `buildSkillGraph` — insert nodes, wire edges from `depends`, compute rootIds/leafIds, collect orphans
- `topologicalSort` — Kahn's algorithm (BFS). Returns skill IDs in dependency order
- `detectCycles` — DFS-based cycle detection. If cycles found, throws `CycleDetectedError` with cycle path
- `getTransitiveDeps` — BFS walk from a node following edges. Used by optimizer

## Error Handling

| Situation | Behavior |
|-----------|----------|
| Cycle detected | `CycleDetectedError` with cycle path. Sync aborts |
| Orphan dependency | Warning logged. Skill still included (dep just ignored) |
| Duplicate skill ID | Warning logged. Last-wins (or source-conflict-strategy applies) |
| No dependencies at all | Valid graph with all nodes as roots. Compiler degrades to current behavior |

## File Location

```
domain/compiler/
  graph.ts    — buildSkillGraph, topologicalSort, detectCycles, getTransitiveDeps
```

## Tests

- Build graph from nodes with valid deps → correct edges, roots, leaves
- Topological sort respects dependency order (A depends on B → B before A)
- Detect simple cycle (A → B → A) → CycleDetectedError
- Detect transitive cycle (A → B → C → A) → CycleDetectedError
- Orphan dependency → warning, skill included
- Duplicate IDs → warning, last-wins
- All nodes independent (no deps) → all are roots, topo sort returns any order
- Single node → trivial graph
- `getTransitiveDeps` walks full chain (A → B → C → returns {B, C})

## Performance

Skill repos typically have 10-100 files. All graph operations are O(V+E) where V=nodes, E=edges. Milliseconds, not seconds.
