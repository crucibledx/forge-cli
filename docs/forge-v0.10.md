# Forge v0.10 — Project Context Detection + Tree-Shaking

> **Milestone:** Forge v0.10 — "Smart Context"
>
> **Prerequisite:** Forge v0.9 (skill graph).
>
> **Scope:** Detect project type from filesystem markers, tree-shake skills
> irrelevant to the project context. This is the first feature that makes Forge
> visibly smarter than a file copier.
>
> **Effort:** ~2 weeks.

---

## Problem

A team's skill repo might have 50 skills covering Java, Python, Rust, frontend, and infrastructure. A Java/Spring project only needs ~12 of those. Today, all 50 get synced — polluting the agent's context window with irrelevant instructions.

## Solution

1. **Detect project context** — scan project root for marker files (pom.xml, package.json, etc.) and infer language/framework tags
2. **Match skills to context** — compare skill `context.languages`/`context.frameworks` against detected project tags
3. **Tree-shake** — remove skills that don't match the project context (unless they have no context filter or are dependencies of matching skills)

## Context Detection

### Phase 1: File-based detection (v0.10 scope)

Scan for known marker files and infer tags:

```typescript
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
  '.terraform/':       [{ type: 'framework', value: 'terraform' }],
}
```

Additional pattern-based detection (reading file content for framework identification):

```typescript
const FRAMEWORK_PATTERNS = {
  'package.json': [
    { pattern: '"react"', tags: [{ type: 'framework', value: 'react' }] },
    { pattern: '"next"', tags: [{ type: 'framework', value: 'nextjs' }] },
    { pattern: '"express"', tags: [{ type: 'framework', value: 'express' }] },
  ],
  'pom.xml': [
    { pattern: 'spring-boot', tags: [{ type: 'framework', value: 'spring' }] },
  ],
}
```

### Phase 2: Config-based override (v0.10 scope)

```yaml
compile:
  context:
    languages: [java, kotlin]
    frameworks: [spring]
    tags: [microservice]
```

## Types

```typescript
interface ContextTag {
  type: 'language' | 'framework' | 'tag'
  value: string
}

interface ProjectContext {
  detected: ContextTag[]       // from filesystem scan
  configured: ContextTag[]     // from forge config
  effective: ContextTag[]      // merged (configured supplements detected)
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

1. Skills with **no context filter** → **always kept** (universal skills)
2. Skills whose context **overlaps** with project context → **kept**
3. Skills that don't match → **candidate for shaking**
4. Shaking candidates that are **transitive dependencies** of a kept skill → **kept** (dependency pull)
5. Skills with `priority >= 90` → **kept regardless** (critical skills escape shaking)

## File Location

```
domain/compiler/
  context.ts     — detectProjectContext, mergeContext, matchesContext
  optimizer.ts   — treeShake

infrastructure/fs/
  detector.ts    — scanProjectMarkers (filesystem I/O)
```

## Tests

### Context detection
- Detect Java project (pom.xml present)
- Detect TypeScript + React (tsconfig.json + package.json with react)
- Detect multi-language project → both detected
- Config supplements detected tags
- Empty project (no markers) → empty context, no shaking

### Tree-shaking
- Skill with matching context → kept
- Skill with non-matching context → shaken
- Universal skill (no context) → always kept
- Shaken skill that is dependency of kept skill → kept (dependency pull)
- High-priority skill (>= 90) → kept regardless
- Empty context → nothing shaken
