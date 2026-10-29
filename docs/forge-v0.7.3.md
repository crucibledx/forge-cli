# Forge v0.7.3 — Project Context Detection + Tree-Shaking

> **Feature:** Detect project type from filesystem markers, tree-shake skills irrelevant to the project context.
>
> **Depends on:** v0.7.2 (skill graph).
>
> **Effort:** ~2 weeks.

---

## Problem

A team's skill repo might have 50 skills covering Java, Python, Rust, frontend, and infrastructure. A Java/Spring project only needs ~12 of those. Today, all 50 get synced — polluting the agent's context window with irrelevant instructions.

## Solution

1. **Detect project context** — scan the project root for marker files (pom.xml, package.json, go.mod, etc.) and infer language/framework tags
2. **Match skills to context** — compare skill `context.languages`/`context.frameworks` against detected project tags
3. **Tree-shake** — remove skills that don't match the project context (unless they have no context filter or are dependencies of matching skills)

## Context Detection

### Phase 1: File-based detection (v0.7 scope)

Scan for known marker files and infer tags:

```typescript
// domain/compiler/context.ts

const CONTEXT_MARKERS: Record<string, ContextTag[]> = {
  'pom.xml':           [{ type: 'language', value: 'java' }, { type: 'framework', value: 'maven' }],
  'build.gradle':      [{ type: 'language', value: 'java' }, { type: 'framework', value: 'gradle' }],
  'build.gradle.kts':  [{ type: 'language', value: 'kotlin' }, { type: 'framework', value: 'gradle' }],
  'package.json':      [{ type: 'language', value: 'javascript' }],
  'tsconfig.json':     [{ type: 'language', value: 'typescript' }],
  'go.mod':            [{ type: 'language', value: 'go' }],
  'Cargo.toml':        [{ type: 'language', value: 'rust' }],
  'pyproject.toml':    [{ type: 'language', value: 'python' }],
  'requirements.txt':  [{ type: 'language', value: 'python' }],
  'Gemfile':           [{ type: 'language', value: 'ruby' }],
  'composer.json':     [{ type: 'language', value: 'php' }],
  'Dockerfile':        [{ type: 'tag', value: 'docker' }],
  'docker-compose.yml':[{ type: 'tag', value: 'docker' }],
  '.terraform/':       [{ type: 'framework', value: 'terraform' }],
}
```

Additional pattern-based detection:

```typescript
const FRAMEWORK_PATTERNS: Record<string, { file: string; pattern: string; tags: ContextTag[] }[]> = {
  'package.json': [
    { file: 'package.json', pattern: '"react"', tags: [{ type: 'framework', value: 'react' }] },
    { file: 'package.json', pattern: '"next"', tags: [{ type: 'framework', value: 'nextjs' }] },
    { file: 'package.json', pattern: '"express"', tags: [{ type: 'framework', value: 'express' }] },
    { file: 'package.json', pattern: '"@angular/core"', tags: [{ type: 'framework', value: 'angular' }] },
  ],
  'pom.xml': [
    { file: 'pom.xml', pattern: 'spring-boot', tags: [{ type: 'framework', value: 'spring' }] },
  ],
}
```

### Phase 2: Config-based override (v0.7 scope)

User can specify context in config (overrides or supplements detection):

```yaml
compile:
  context:
    languages: [java, kotlin]
    frameworks: [spring]
    tags: [microservice]
```

### Phase 3: Smart detection (future)

Infer project domain from README, directory structure, etc. Out of scope for v0.7.

## Types

```typescript
interface ContextTag {
  type: 'language' | 'framework' | 'tag'
  value: string
}

interface ProjectContext {
  detected: ContextTag[]       // from filesystem scan
  configured: ContextTag[]     // from forge config
  effective: ContextTag[]      // merged (configured overrides detected)
}
```

## Tree-Shaking Algorithm

```typescript
function treeShake(graph: SkillGraph, context: ProjectContext): TreeShakeResult

interface TreeShakeResult {
  kept: Set<string>           // skill IDs that survived
  shaken: Set<string>         // skill IDs that were removed
  reasons: Map<string, string> // skillId → why it was kept/shaken
}
```

**Rules:**

1. Skills with **no context filter** (`context` field absent) → **always kept** (universal skills)
2. Skills whose `context.languages` or `context.frameworks` **overlap** with project context → **kept**
3. Skills that don't match context → **candidate for shaking**
4. **But**: if a shaking candidate is a **transitive dependency** of a kept skill → **kept anyway** (dependency pull)
5. Skills with `priority >= 90` → **kept regardless** (critical skills escape shaking)

**Algorithm:**

```
1. Mark all context-matching skills as KEEP
2. Mark all universal skills (no context filter) as KEEP
3. Mark all priority >= 90 skills as KEEP
4. Walk dependencies of all KEEP skills → mark transitive deps as KEEP
5. Everything else → SHAKE
```

## File Location

```
domain/compiler/
  context.ts     — detectProjectContext, mergeContext, matchesContext
  optimizer.ts   — treeShake (part of the optimizer module)

infrastructure/fs/
  detector.ts    — scanProjectMarkers (filesystem I/O for detecting marker files)
```

Note: `context.ts` is pure domain logic (matching). `detector.ts` is infrastructure (filesystem scanning). The context detection function in domain receives detected tags as input — it doesn't do I/O itself.

## Tests

### Context detection
- Detect Java project (pom.xml present)
- Detect TypeScript + React project (tsconfig.json + package.json with react)
- Detect multi-language project (pom.xml + package.json) → both detected
- Config override supplements detected tags
- Empty project (no markers) → empty context, no shaking

### Tree-shaking
- Skill with matching context → kept
- Skill with non-matching context → shaken
- Universal skill (no context) → always kept
- Shaken skill that is dependency of kept skill → kept (dependency pull)
- High-priority skill (>= 90) → kept regardless of context
- All skills universal → nothing shaken
- Empty context → nothing shaken (no basis for filtering)

## Edge Cases

- Project with both `pom.xml` AND `package.json` (full-stack) → both Java and JS detected, wide context keeps more skills
- Skill with `context.languages: [java]` in a Python project → shaken (unless dependency-pulled)
- Circular dependency pull — handled by graph's cycle detection (v0.7.2)
