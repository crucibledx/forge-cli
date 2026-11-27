import {stat} from 'node:fs/promises'

import type {PluginFile, PluginPackage} from '@domain/plugins'
import {buildPluginPackage, layerComponents, PLUGIN_COMPONENT_KINDS as K} from '@domain/plugins'

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

/** Static validation of package files: the manifest, then every JSON component in any layer. */
export function checkPluginFiles(files: PluginFile[]): PluginCheck {
  const manifestFile = files.find((file) => file.path === 'plugin.json')
  if (!manifestFile) return {errors: ['plugin.json: missing at the package root'], warnings: []}
  const raw = parseJson(manifestFile)
  if (raw.error) return {errors: [raw.error], warnings: []}
  const {manifest, errors, warnings} = checkManifest(raw.value)
  if (!manifest) return {errors, warnings}
  const pkg = buildPluginPackage(manifest, files)
  for (const component of layerComponents(files)) {
    const suffix = JSON_FILES[component.kind]
    if (suffix === undefined) continue
    const path = component.root + suffix
    const file = component.files.find((candidate) => candidate.path === path)!
    const parsed = parseJson(file)
    if (parsed.error) errors.push(parsed.error)
    else if (component.kind === K.MCP) errors.push(...checkMcpConfig(path, parsed.value))
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
