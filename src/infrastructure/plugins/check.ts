import {stat} from 'node:fs/promises'

import {COMPONENT_KINDS as K} from '@domain/harnesses/types'
import type {PluginFile, PluginPackage} from '@domain/plugins'
import {buildPluginPackage, layerComponents} from '@domain/plugins'

import {readPluginFiles} from './files'
import {checkManifest, checkMcpConfig} from './manifest'

export interface PluginCheck {
  pkg?: PluginPackage
  errors: string[]
  warnings: string[]
}

const JSON_FILES: Partial<Record<string, string>> = {[K.MCP]: '', [K.LSP]: '', [K.SETTING]: '', [K.HOOK]: '/hooks.json'}

function parseJson(file: PluginFile): {value?: unknown; error?: string} {
  try {
    return {value: JSON.parse(new TextDecoder().decode(file.content))}
  } catch (error) {
    return {error: `${file.path}: not valid JSON (${error instanceof Error ? error.message : String(error)})`}
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A hooks file is either a direct event map ({SessionStart: [...]}) or a {"hooks": {...}} wrapper around one; every
 * event value must be an array. Anything else would fail or be silently dropped when Droid reads it.
 */
function checkHooksConfig(path: string, value: unknown): string[] {
  if (!isObject(value))
    return [`${path}: hooks must be a JSON object keyed by event name or a {"hooks": {...}} wrapper`]
  const events = 'hooks' in value ? value.hooks : value
  if (!isObject(events)) return [`${path}: "hooks" must be an object keyed by event name`]
  return Object.entries(events)
    .filter(([, entries]) => !Array.isArray(entries))
    .map(([event]) => `${path}: hook event "${event}" must be an array`)
}

/** Static validation of package files: the manifest, then every JSON component in any layer. */
export function checkPluginFiles(files: PluginFile[]): PluginCheck {
  const manifestFile = files.find((file) => file.path === 'plugin.json')
  if (!manifestFile) return {errors: ['plugin.json: missing at the package root'], warnings: []}
  const raw = parseJson(manifestFile)
  if (raw.error) return {errors: [raw.error], warnings: []}
  const {manifest, errors, warnings} = checkManifest(raw.value)
  if (!manifest) return {errors, warnings}
  const pkg = buildPluginPackage(manifest, files)
  // The emitters generate forge/rules.md and forge/print-rules.cjs at the package root; a packaged file there
  // would collide with them (duplicate emitted paths).
  for (const file of files)
    if (file.path.startsWith('forge/'))
      errors.push(`${file.path}: the forge/ directory is reserved for forge-generated plugin files`)
  for (const component of layerComponents(files)) {
    const suffix = JSON_FILES[component.kind]
    if (suffix === undefined) continue
    const path = component.root + suffix
    const file = component.files.find((candidate) => candidate.path === path)!
    const parsed = parseJson(file)
    if (parsed.error) errors.push(parsed.error)
    else if (component.kind === K.MCP) errors.push(...checkMcpConfig(path, parsed.value))
    else if (component.kind === K.HOOK) errors.push(...checkHooksConfig(path, parsed.value))
  }
  return errors.length
    ? {errors, warnings: [...warnings, ...pkg.warnings]}
    : {pkg, errors, warnings: [...warnings, ...pkg.warnings]}
}

export async function checkPluginDirectory(dir: string): Promise<PluginCheck> {
  if (!(await stat(dir).catch(() => null))?.isDirectory())
    return {errors: [`${dir}: not a plugin package directory`], warnings: []}
  try {
    return checkPluginFiles(await readPluginFiles(dir))
  } catch (error) {
    return {errors: [error instanceof Error ? error.message : String(error)], warnings: []}
  }
}
