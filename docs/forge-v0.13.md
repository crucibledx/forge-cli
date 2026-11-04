# Forge v0.13 — Manifest Generation (Ember Bridge)

> **Milestone:** Forge v0.13 — "Build Manifest"
>
> **Prerequisite:** Forge v0.12 (emitter output).
>
> **Scope:** Emit `.crucible/forge.manifest.json` on every compile — a structured
> record of which skills, versions, agents, and token estimates were produced.
> This is the contract between Forge (producer) and Ember (consumer).
>
> **Effort:** ~1 week.

---

## Problem

After a sync, there's no machine-readable record of what was compiled. Ember needs to know which skills, which versions, which agents, which projects to compute adoption, drift, and cost attribution.

## Manifest Schema

```json
{
  "schema_version": "1.0.0",
  "compiled_at": "2026-09-14T16:00:00Z",
  "forge_version": "0.13.0",
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
    { "id": "python-lint", "reason": "context_mismatch" },
    { "id": "rust-conventions", "reason": "budget_exceeded" }
  ],
  "sources": [
    { "name": "team-skills", "type": "git", "ref": "main", "commit": "abc1234" }
  ]
}
```

## Implementation

```typescript
// domain/compiler/manifest.ts

function buildManifest(input: ManifestInput): ForgeManifest
function serializeManifest(manifest: ForgeManifest): string

// infrastructure/config/writer.ts (extended)
function writeManifest(projectRoot: string, manifest: ForgeManifest): Promise<void>
```

## Versioning

`schema_version` uses semver:
- **Major**: breaking schema changes
- **Minor**: new optional fields
- **Patch**: docs only

Starting at `1.0.0`. Ember reads `schema_version` and handles multiple versions.

## Skill Versioning

The `version` field comes from (in priority order):
1. Frontmatter `version` field
2. Git tag (if source is git and commit has a tag)
3. Git commit short hash (fallback)
4. `"unknown"`

## File Location

Written to `<projectRoot>/.crucible/forge.manifest.json`. Should be **committed** to git (enables CI pipelines, Ember discovery, version history).

```
domain/compiler/
  manifest.ts     — buildManifest, manifestSchema, types
infrastructure/config/
  writer.ts       — writeManifest (extended)
```

## Tests

- Build manifest from full compiler output → all fields populated
- Skills without version → "unknown"
- Empty tree-shaken list → empty array
- No budgets → utilization omitted
- Schema validates with Zod
- Round-trip: build → serialize → parse → validate

## Integration Point

This is the **bridge to Ember**. Once this ships, Ember can start consuming real data without any runtime instrumentation.
