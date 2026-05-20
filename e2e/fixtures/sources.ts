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
 */
export interface SourceTreeDescriptor {
  skills?: Record<string, string>
  rules?: Record<string, string>
  workflows?: Record<string, string>
}

/**
 * Creates a complete source directory from a descriptor.
 *
 * @example
 *   await writeSourceTree(sourceDir, {
 *     skills: { 'deploy.md': '# Deploy' },
 *     rules: { 'api.md': RULE_WITH_PATHS },
 *   })
 */
export async function writeSourceTree(sourceDir: string, tree: SourceTreeDescriptor): Promise<void> {
  const writes: Promise<void>[] = []

  for (const [category, files] of Object.entries(tree)) {
    if (!files) continue
    for (const [filename, content] of Object.entries(files as Record<string, string>)) {
      writes.push(writeSourceFile(sourceDir, `${category}/${filename}`, content))
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
