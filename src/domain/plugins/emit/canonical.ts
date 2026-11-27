import type {ComponentKind} from '../../harnesses/types'
import {COMPONENT_KINDS as K} from '../../harnesses/types'
import {compare} from '../package'
import type {PluginComponent, PluginFile, PluginHarnessId, PluginManifest, PluginPackage} from '../types'
import {FORGE_NAMESPACE, VENDOR_NAMESPACES} from '../types'

const braced = (name: string) => '${' + name + '}'
/** Agent Plugins variables and their Claude Code names, which Droid provides as well. */
const PLUGIN_VARIABLES: ReadonlyArray<[string, string]> = [
  [braced('PLUGIN_ROOT'), braced('CLAUDE_PLUGIN_ROOT')],
  [braced('PLUGIN_DATA'), braced('CLAUDE_PLUGIN_DATA')],
]

/**
 * Top-level package names that are components, package metadata or a harness loader's location. A package file
 * under one of them is delivered as a component or not at all; every other file is an asset the plugin ships as is.
 */
const RESERVED_NAMES = new Set([
  'plugin.json',
  'tests',
  FORGE_NAMESPACE,
  ...Object.values(VENDOR_NAMESPACES),
  '.claude-plugin',
  '.factory-plugin',
  'skills',
  'commands',
  'agents',
  'droids',
  'hooks',
  'output-styles',
  'rules',
  'monitors',
  'mcp.json',
  '.mcp.json',
  'lsp.json',
  '.lsp.json',
  'settings.json',
])

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export function textFile(path: string, text: string): PluginFile {
  return {path, content: encoder.encode(text)}
}

const jsonFile = (path: string, value: unknown) => textFile(path, JSON.stringify(value, null, 2) + '\n')

/** Rewrites `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` to the plugin-root variables both harnesses resolve. */
export function mapPluginVariables(text: string): string {
  return PLUGIN_VARIABLES.reduce((out, [from, to]) => out.replaceAll(from, to), text)
}

const mappedFile = (path: string, file: PluginFile) => textFile(path, mapPluginVariables(decoder.decode(file.content)))

/** The component's file path below its root: `''` for a single-file component. */
const below = (component: PluginComponent, file: PluginFile) => file.path.slice(component.root.length)

type Placement = (component: PluginComponent, file: PluginFile) => PluginFile

function mcpConfig(file: PluginFile): PluginFile {
  const config = JSON.parse(mapPluginVariables(decoder.decode(file.content))) as Record<string, unknown>
  // The Agent Plugins schema reference does not describe the Claude Code `.mcp.json` it becomes.
  delete config.$schema
  return jsonFile('.mcp.json', config)
}

const CANONICAL_PLACEMENTS: Partial<Record<ComponentKind, Placement>> = {
  [K.SKILL]: (component, file) => ({...file, path: `skills/${component.name}${below(component, file)}`}),
  [K.COMMAND]: (component, file) => ({...file, path: `commands/${component.name}.md`}),
  [K.AGENT]: (component, file) => ({...file, path: `agents/${component.name}.md`}),
  [K.OUTPUT_STYLE]: (component, file) => ({...file, path: `output-styles/${component.name}.md`}),
  [K.HOOK]: (component, file) => {
    const path = `hooks${below(component, file)}`
    return path === 'hooks/hooks.json' ? mappedFile(path, file) : {...file, path}
  },
  [K.MCP]: (_component, file) => mcpConfig(file),
}

function pluginManifest({name, version, description}: PluginManifest): PluginFile {
  return jsonFile('.claude-plugin/plugin.json', {name, version, ...(description === undefined ? {} : {description})})
}

export function sortPluginFiles(files: PluginFile[]): PluginFile[] {
  return files.sort((a, b) => compare(a.path, b.path))
}

/**
 * The canonical Claude Code plugin layout that both Claude Code and Droid install (spec 0003 §5): the manifest,
 * skills, commands, agents, hooks, `.mcp.json`, output styles and package assets, from the harness's view of the
 * package. Rules, LSP servers and settings are left to each harness's emitter.
 */
export function emitCanonical(pkg: PluginPackage, harness: PluginHarnessId): PluginFile[] {
  const assets = pkg.files.filter((file) => !RESERVED_NAMES.has(file.path.split('/')[0]))
  const components = pkg.components[harness].flatMap((component) => {
    const place = CANONICAL_PLACEMENTS[component.kind]
    return place ? component.files.map((file) => place(component, file)) : []
  })
  return sortPluginFiles([pluginManifest(pkg.manifest), ...assets, ...components])
}
