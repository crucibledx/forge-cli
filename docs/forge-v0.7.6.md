# Forge v0.7.6 — Manifest Generation (Ember Bridge)

> **Feature:** Emit a structured manifest file on every compile, capturing which skills, versions, agents, and token estimates were produced. This is the data source for Ember.
>
> **Depends on:** v0.7.5 (emitter output).
>
> **Effort:** ~1 week.

---

## Problem

After a sync, there's no machine-readable record of what was compiled. Ember needs to know which skills, which versions, which agents, and which projects to compute adoption rates, drift, and cost attribution.

## Solution

Write `.crucible/forge.manifest.json` on every compile. This file is the contract between Forge (producer) and Ember (consumer).

## Manifest Schema

```json
{
  "schema_version": "1.0.0",
  "compiled_at": "2026-09-14T16:00:00Z",
  "forge_version": "0.7.0",
  "project": {
    "name": "my-java-service",
    "root": "/Users/dev/projects/my-java-service"
  },
  "context": {
    "detected": ["java", "spring", "gradle"],
    "configured": ["java"],
    "effective": ["java", "spring", "gradle"]
  },
  "compile": {
    "skills_parsed": 50,
    "skills_kept": 12,
    "skills_shaken": 38,
    "duration_ms": 47
  },
  "agents": {
    "claude-code": {
      "files_emitted": 12,
      "total_tokens": 8400,
      "budget": 15000,
      "utilization": 0.56
    },
    "cursor": {
      "files_emitted": 4,
      "total_tokens": 7200,
      "budget": 10000,
      "utilization": 0.72
    }
  },
  "skills": [
    {
      "id": "study-java",
      "version": "2.1.0",
      "hash": "a1b2c3d4e5f6",
      "source": "team-skills",
      "priority": 90,
      "depends_on": ["detect-project"],
      "tags": ["java", "analysis"],
      "token_estimate": 1200,
      "emitted_to": {
        "claude-code": ".claude/skills/001-study-java.md",
        "cursor": ".cursor/rules/java-rules.mdc"
      }
    }
  ],
  "tree_shaken": [
    {
      "id": "python-lint",
      "reason": "context_mismatch",
      "context_languages": ["python"]
    },
    {
      "id": "rust-conventions",
      "reason": "budget_exceeded",
      "priority": 30
    }
  ],
  "sources": [
    {
      "name": "team-skills",
      "type": "git",
      "ref": "main",
      "commit": "abc1234"
    }
  ]
}
```

## Zod Schema

```typescript
// domain/compiler/manifest.ts

const manifestSkillSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  hash: z.string(),
  source: z.string(),
  priority: z.number(),
  depends_on: z.array(z.string()),
  tags: z.array(z.string()),
  token_estimate: z.number(),
  emitted_to: z.record(z.string()),   // agentId → target path
})

const manifestSchema = z.object({
  schema_version: z.string(),
  compiled_at: z.string(),
  forge_version: z.string(),
  project: z.object({
    name: z.string().optional(),
    root: z.string(),
  }),
  context: z.object({
    detected: z.array(z.string()),
    configured: z.array(z.string()),
    effective: z.array(z.string()),
  }),
  compile: z.object({
    skills_parsed: z.number(),
    skills_kept: z.number(),
    skills_shaken: z.number(),
    duration_ms: z.number(),
  }),
  agents: z.record(z.object({
    files_emitted: z.number(),
    total_tokens: z.number(),
    budget: z.number().optional(),
    utilization: z.number().optional(),
  })),
  skills: z.array(manifestSkillSchema),
  tree_shaken: z.array(z.object({
    id: z.string(),
    reason: z.string(),
    context_languages: z.array(z.string()).optional(),
    priority: z.number().optional(),
  })),
  sources: z.array(z.object({
    name: z.string(),
    type: z.string(),
    ref: z.string().optional(),
    commit: z.string().optional(),
  })),
})
```

## Implementation

```typescript
// domain/compiler/manifest.ts

interface ManifestInput {
  projectRoot: string
  projectName?: string
  forgeVersion: string
  context: ProjectContext
  graph: SkillGraph
  treeShakeResult: TreeShakeResult
  emitResults: Map<string, EmitResult>
  budgetResults: Map<string, BudgetResult>
  sources: Source[]
  compileDurationMs: number
}

function buildManifest(input: ManifestInput): ForgeManifest
function serializeManifest(manifest: ForgeManifest): string  // pretty JSON

// infrastructure/config/writer.ts (extended)
function writeManifest(projectRoot: string, manifest: ForgeManifest): Promise<void>
```

## Versioning

The `schema_version` field uses semver:
- **Major bump**: breaking changes to schema (fields removed/renamed)
- **Minor bump**: new optional fields added
- **Patch bump**: documentation/description changes

Starting at `1.0.0`. Ember reads `schema_version` and can handle multiple versions.

## Skill Versioning

The `version` field in manifest skills comes from:

1. **Frontmatter `version` field** (if present in the skill file)
2. **Git tag** (if the source is git and the commit has a tag)
3. **Git commit short hash** (fallback)
4. **`"unknown"`** (if none of the above)

This is a best-effort field. Ember uses it for drift detection — even "unknown" is useful (it means "this skill has no versioning").

## File Location

The manifest is written to:
- **Project mode**: `<projectRoot>/.crucible/forge.manifest.json`
- **Global mode**: `~/.crucible/forge.manifest.json`

Same location as other Forge state files.

```
domain/compiler/
  manifest.ts     — buildManifest, manifestSchema, types

infrastructure/config/
  writer.ts       — writeManifest (extended, not new file)
```

## Gitignore

The manifest should be **committed** to git (not gitignored). This enables:
- CI/CD pipelines to read manifests
- Ember to discover manifests across cloned repos
- Version history of manifest changes

## Tests

- Build manifest from full compiler output → all fields populated
- Skills without version → "unknown"
- Empty tree-shaken list → empty array
- No budgets configured → utilization omitted
- Schema validates with Zod
- Manifest is valid JSON, parseable
- Round-trip: buildManifest → serialize → parse → validate

## Integration Point

The manifest generation is the **bridge to Ember**. It captures everything Ember needs (Tier 1) without any runtime instrumentation. Once this ships, Ember can start consuming real data.
