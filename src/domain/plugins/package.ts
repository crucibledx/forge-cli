import type {
  PluginComponent,
  PluginComponentKind,
  PluginFile,
  PluginHarnessId,
  PluginManifest,
  PluginPackage,
} from './types'
import {FORGE_NAMESPACE, PLUGIN_COMPONENT_KINDS as K, PLUGIN_HARNESS_IDS, VENDOR_NAMESPACES} from './types'

const PORTABLE_KINDS = new Set<PluginComponentKind>([K.SKILL, K.MCP])
const SINGLE_FILES: Record<string, PluginComponentKind> = {
  'mcp.json': K.MCP,
  'lsp.json': K.LSP,
  'settings.json': K.SETTING,
}
const MARKDOWN_DIRS: Record<string, PluginComponentKind> = {
  agents: K.AGENT,
  commands: K.COMMAND,
  rules: K.RULE,
  'output-styles': K.OUTPUT_STYLE,
}
/** Directory components exist only when they carry this file. */
const REQUIRED_FILE: Partial<Record<PluginComponentKind, string>> = {[K.SKILL]: 'SKILL.md', [K.HOOK]: 'hooks.json'}
const LAYERS = new Set([FORGE_NAMESPACE, ...Object.values(VENDOR_NAMESPACES)])

interface Slot {
  kind: PluginComponentKind
  name: string
  root: string
}

function classify(rel: string): Slot | undefined {
  const parts = rel.split('/')
  const [top, second] = parts
  if (parts.length === 1) return SINGLE_FILES[top] && {kind: SINGLE_FILES[top], name: SINGLE_FILES[top], root: top}
  if (top === 'skills' && parts.length >= 3) return {kind: K.SKILL, name: second, root: `skills/${second}`}
  if (top === 'hooks') return {kind: K.HOOK, name: 'hooks', root: 'hooks'}
  const kind = MARKDOWN_DIRS[top]
  if (kind && parts.length === 2 && second.endsWith('.md')) return {kind, name: second.slice(0, -3), root: rel}
}

function isPathScoped(content: Uint8Array): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(new TextDecoder().decode(content))
  return frontmatter !== null && /^paths\s*:/m.test(frontmatter[1])
}

/** Group package files into components per layer, then resolve each harness's view by layer precedence. */
export function buildPluginPackage(manifest: PluginManifest, files: PluginFile[]): PluginPackage {
  const warnings: string[] = []
  const misplaced = new Set<string>()
  const layers = new Map<string, Map<string, PluginComponent>>()
  for (const file of files) {
    const [top] = file.path.split('/')
    const origin = LAYERS.has(top) ? top : ''
    const rel = origin ? file.path.slice(origin.length + 1) : file.path
    const slot = classify(rel)
    if (!slot || (!origin && !PORTABLE_KINDS.has(slot.kind))) {
      if (origin) warnings.push(`Unrecognized file in ${origin}/: ${rel} (ignored)`)
      else if (slot && !misplaced.has(slot.root)) {
        misplaced.add(slot.root)
        warnings.push(`${slot.root}: ${slot.kind} is not portable; move it under ${FORGE_NAMESPACE}/ (ignored)`)
      }
      continue
    }
    const layer = layers.get(origin) ?? layers.set(origin, new Map()).get(origin)!
    const key = `${slot.kind}:${slot.name}`
    const root = origin ? `${origin}/${slot.root}` : slot.root
    const component = layer.get(key) ?? layer.set(key, {...slot, origin, root, files: []}).get(key)!
    component.files.push(file)
  }
  for (const layer of layers.values())
    for (const [key, component] of layer) {
      const required = REQUIRED_FILE[component.kind]
      if (required && !component.files.some((file) => file.path === `${component.root}/${required}`)) {
        warnings.push(`${component.root} has no ${required} (ignored)`)
        layer.delete(key)
      } else if (component.kind === K.RULE) component.pathScoped = isPathScoped(component.files[0].content)
    }
  const components = Object.fromEntries(
    PLUGIN_HARNESS_IDS.map((harness) => {
      const merged = new Map([
        ...(layers.get('') ?? []),
        ...(layers.get(FORGE_NAMESPACE) ?? []),
        ...(layers.get(VENDOR_NAMESPACES[harness]) ?? []),
      ])
      const list = [...merged.values()].sort((a, b) => compare(a.kind, b.kind) || compare(a.name, b.name))
      return [harness, list]
    }),
  ) as Record<PluginHarnessId, PluginComponent[]>
  return {manifest, files, components, warnings}
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
