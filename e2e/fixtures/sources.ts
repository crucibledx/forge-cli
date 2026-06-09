import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

// ─── Source file writers ─────────────────────────────────────────────────────

/**
 * Writes a single file into a source directory, creating parent dirs as needed.
 */
export async function writeSourceFile(sourceDir: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(sourceDir, relativePath)
  await mkdir(join(fullPath, '..'), {recursive: true})
  await writeFile(fullPath, content)
}

/**
 * Descriptor for building a complete source tree.
 * Supports nested directories: values can be files (string) or subdirectories (nested record).
 */
export type SourceTreeDescriptor = Record<string, string | Record<string, string | Record<string, string>>>

/**
 * Creates a complete source directory from a descriptor.
 * Supports arbitrarily nested structures.
 *
 * @example
 *   await writeSourceTree(sourceDir, {
 *     skills: { 'deploy.md': '# Deploy' },
 *     rules: { 'api.md': RULE_WITH_PATHS },
 *     '.claude': { rules: { 'api.md': '# Claude rule' } },
 *   })
 */
export async function writeSourceTree(sourceDir: string, tree: SourceTreeDescriptor, prefix = ''): Promise<void> {
  const writes: Promise<void>[] = []

  for (const [key, value] of Object.entries(tree)) {
    if (!value) continue
    const relativePath = prefix ? `${prefix}/${key}` : key

    if (typeof value === 'string') {
      writes.push(writeSourceFile(sourceDir, relativePath, value))
    } else {
      writes.push(writeSourceTree(sourceDir, value as SourceTreeDescriptor, relativePath))
    }
  }

  await Promise.all(writes)
}

// ─── Target file reader ──────────────────────────────────────────────────────

/**
 * Reads a synced target file relative to the project root.
 */
export async function readTarget(projectDir: string, relativePath: string): Promise<string> {
  return readFile(join(projectDir, relativePath), 'utf-8')
}

// ─── Sample content ──────────────────────────────────────────────────────────

/** A rule with `paths` frontmatter — used to test frontmatter-rename transforms */
export const RULE_WITH_PATHS = `---
paths:
  - "src/**"
---
Use strict mode.`

/** A rule with multiple paths — used to test multi-value frontmatter preservation */
export const RULE_WITH_MULTI_PATHS = `---
paths:
  - "src/api/**/*.ts"
  - "src/core/**/*.ts"
---
All endpoints must validate input.

Use zod for schemas.`

/** A simple skill with no frontmatter */
export const SKILL_DEPLOY = '# Deploy skill'

/** A simple skill for update tests */
export const SKILL_DEPLOY_V1 = '# Deploy v1'
export const SKILL_DEPLOY_V2 = '# Deploy v2'
