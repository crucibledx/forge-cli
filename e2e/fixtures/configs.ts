import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {configFilePath} from '@test-helpers/tmp'

import type {SourceTreeDescriptor} from './sources'
import {writeSourceTree} from './sources'

// ─── Config YAML builders ────────────────────────────────────────────────────

export interface LocalSourceOptions {
  name?: string
  path: string
}

export interface GitSourceOptions {
  name?: string
  url: string
  branch?: string
}

export interface ConfigOptions {
  assistants: string[]
  localSource?: LocalSourceOptions
  gitSource?: GitSourceOptions
  rawSources?: string
}

/**
 * Builds a forge config YAML string from structured options.
 */
export function buildConfigYaml(options: ConfigOptions): string {
  const assistantLines = options.assistants.map((a) => `  - id: ${a}\n    enabled: true`).join('\n')

  let sourcesBlock: string
  if (options.rawSources) {
    sourcesBlock = options.rawSources
  } else if (options.localSource) {
    const name = options.localSource.name ?? 'test-source'
    sourcesBlock = [`  - name: ${name}`, '    type: local', `    path: "${options.localSource.path}"`].join('\n')
  } else if (options.gitSource) {
    const name = options.gitSource.name ?? 'team-rules'
    const branch = options.gitSource.branch ?? 'main'
    sourcesBlock = [
      `  - name: ${name}`,
      '    type: git',
      `    url: "${options.gitSource.url}"`,
      `    branch: "${branch}"`,
    ].join('\n')
  } else {
    sourcesBlock = '[]'
  }

  const assistantsYaml = assistantLines ? `assistants:\n${assistantLines}` : 'assistants: []'
  const sourcesYaml = sourcesBlock === '[]' ? 'sources: []' : `sources:\n${sourcesBlock}`

  return ['version: "1"', assistantsYaml, sourcesYaml, ''].join('\n')
}

/**
 * Writes a forge config to the project's `.crucible/forge.config.yaml`.
 */
export async function writeConfig(projectDir: string, yaml: string): Promise<void> {
  await mkdir(join(projectDir, '.crucible'), {recursive: true})
  await writeFile(configFilePath(projectDir), yaml)
}

/**
 * Sets up a local source directory + forge config in one call.
 * Returns the source directory path.
 */
export async function setupLocalSync(
  projectDir: string,
  assistants: string[],
  tree: SourceTreeDescriptor,
): Promise<string> {
  const sourceDir = join(projectDir, 'source')
  await writeSourceTree(sourceDir, tree)
  await writeConfig(projectDir, buildConfigYaml({assistants, localSource: {path: sourceDir}}))
  return sourceDir
}
