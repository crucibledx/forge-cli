# Forge v0.8 — Skill Frontmatter Schema + Parser

> **Milestone:** Forge v0.8 — "Compiler Foundation"
>
> **Prerequisite:** Forge v0.6.24+ (v0.7 Smithery adapter is independent, not required).
>
> **Scope:** Parse YAML frontmatter from skill files and extract compiler metadata.
> This is the foundation — every subsequent compiler feature depends on this.
>
> **Effort:** ~1 week.

---

## Problem

Forge treats skill files as opaque blobs — it copies content without understanding what's inside. To compile, the pipeline needs structured metadata: dependencies, tags, priority, context hints.

## Solution

Parse YAML frontmatter from `.md` skill files and extract a `SkillFrontmatter` object. Files without frontmatter work as-is (leaf nodes, default values).

## Frontmatter Schema

```yaml
---
name: Study Java
description: Analyze Java project conventions before making changes
depends:
  - detect-project
tags:
  - java
  - analysis
context:
  languages: [java, kotlin]
  frameworks: [spring]
priority: 90
budget: 1500
---
```

All fields optional. A file with no frontmatter = leaf node with:
- `priority: 50` (default)
- `depends: []`
- `tags: []`
- `context: undefined`
- `budget: undefined`

## Types

```typescript
// domain/compiler/types.ts

interface SkillFrontmatter {
  name?: string
  description?: string
  depends?: string[]
  tags?: string[]
  context?: ContextHints
  priority?: number        // 0-100, default 50
  budget?: number           // max token estimate
  [key: string]: unknown    // passthrough for agent-specific fields
}

interface ContextHints {
  languages?: string[]
  frameworks?: string[]
}

interface SkillNode {
  id: string                // derived from filename (e.g., "study-java" from "study-java.md")
  path: string              // relative path in source
  content: string           // raw file content
  frontmatter: SkillFrontmatter
  bodyContent: string       // content after frontmatter block
  hash: string              // content hash for caching/dedup
}
```

## Implementation

```typescript
// domain/compiler/parser.ts

function parseSkillFile(file: SourceFile): SkillNode
function extractFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string }
function deriveSkillId(relativePath: string): string
```

- `extractFrontmatter` — detects `---` delimiters, parses YAML between them, validates with Zod schema
- `deriveSkillId` — strips extension and path prefix: `skills/study-java.md` → `study-java`
- `parseSkillFile` — combines extraction + ID derivation + hashing

## Validation

Zod schema for frontmatter:

```typescript
const skillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  depends: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  context: z.object({
    languages: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
  }).optional(),
  priority: z.number().min(0).max(100).optional(),
  budget: z.number().positive().optional(),
}).passthrough()  // allow agent-specific fields
```

Invalid frontmatter = warning (logged), treated as empty frontmatter. Never a hard error — graceful degradation.

## File Location

```
domain/compiler/
  types.ts     — SkillNode, SkillFrontmatter, ContextHints
  parser.ts    — parseSkillFile, extractFrontmatter, deriveSkillId
  index.ts     — barrel
```

## Tests

- Parse file with full frontmatter → all fields extracted
- Parse file with no frontmatter → default values
- Parse file with partial frontmatter → present fields extracted, rest defaults
- Parse file with invalid YAML → warning, treated as no frontmatter
- `deriveSkillId` strips paths and extensions correctly
- Passthrough fields preserved (agent-specific keys)
- Hash is deterministic for same content

## Edge Cases

- Files with `---` in body content (not frontmatter) — only first `---...---` block is parsed
- Non-`.md` files — passed through as-is, no parsing
- Empty files — valid SkillNode with empty body
- Duplicate skill IDs from different paths — handled in graph stage (v0.9), not here
