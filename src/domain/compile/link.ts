import {parse as parseYaml} from 'yaml'

import {COMPONENT_KINDS as K} from '../harnesses/types'
import type {PluginComponent, PluginPackage} from '../plugins/types'
import type {CompileDiagnostic} from './types'
import {DIAGNOSTIC_CODES} from './types'

export interface LinkComponent {
  /** `<plugin>/<kind>/<name>` */
  id: string
  name: string
  plugin: string
  /** Dependency edges: the ids this component links to, sorted. */
  deps: string[]
  diagnostics: CompileDiagnostic[]
}

const decoder = new TextDecoder()
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Frontmatter and body of a markdown component's primary file; frontmatter that is not YAML parses as empty. */
function splitFrontmatter(content: Uint8Array): {data: Record<string, unknown>; body: string} {
  const text = decoder.decode(content)
  const match = FRONTMATTER.exec(text)
  if (!match) return {data: {}, body: text}
  try {
    const data: unknown = parseYaml(match[1], {logLevel: 'error'})
    return {
      data: typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {},
      body: text.slice(match[0].length),
    }
  } catch {
    return {data: {}, body: text.slice(match[0].length)}
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Names an edge source declared and the diagnostic an unresolved one earns, or null for mention-only sources. */
const unresolved = (component: LinkComponent, source: string, name: string) =>
  component.diagnostics.push({
    code: DIAGNOSTIC_CODES.LINK_UNRESOLVED,
    severity: 'warning',
    message: `unresolved ${source}: ${name}`,
  })

/**
 * The link pass (spec 0005 §3): dependency edges inside the unit from frontmatter `requires`, `subagent_type`
 * references and explicit `/<name>` mentions. A `requires` or `subagent_type` name with no target in the unit is a
 * warning; a `/<name>` mention that matches nothing is prose, not a reference. Edges never cross units.
 */
export function linkComponents(packages: readonly PluginPackage[], harness: string): LinkComponent[] {
  const named = packages.flatMap((pkg) =>
    pkg.components[harness as keyof PluginPackage['components']]
      .filter((component) => [K.SKILL, K.AGENT, K.COMMAND].includes(component.kind as never))
      .map((component) => ({pkg, component})),
  )
  const byName = new Map<string, string>()
  for (const {pkg, component} of named) {
    const id = `${pkg.manifest.name}/${component.kind}/${component.name}`
    if (!byName.has(component.name)) byName.set(component.name, id)
  }
  const idOf = (pkg: PluginPackage, component: PluginComponent) =>
    `${pkg.manifest.name}/${component.kind}/${component.name}`
  return named.map(({pkg, component}) => {
    const self: LinkComponent = {
      id: idOf(pkg, component),
      name: component.name,
      plugin: pkg.manifest.name,
      deps: [],
      diagnostics: [],
    }
    const {data, body} = splitFrontmatter(component.files[0]?.content ?? new Uint8Array())
    const deps = new Set<string>()
    const requires = data.requires
    for (const name of Array.isArray(requires) ? requires : typeof requires === 'string' ? [requires] : []) {
      const target = byName.get(String(name).replace(/^\//, ''))
      if (target && target !== self.id) deps.add(target)
      else if (!target) unresolved(self, 'requires', String(name))
    }
    const text = `${JSON.stringify(data)}\n${body}`
    // Names are letters, digits, '_' and '-', with ':' for a namespaced reference; prose punctuation never matches.
    for (const match of text.matchAll(/subagent_type\s*[=:]\s*["']?([A-Za-z0-9_:-]+)["']?/g)) {
      const target = byName.get(match[1]) ?? byName.get(match[1].split(':').pop()!)
      if (target && target !== self.id) deps.add(target)
      else if (!target) unresolved(self, 'subagent_type', match[1])
    }
    for (const [name, target] of byName) {
      if (target === self.id) continue
      if (new RegExp(`(?<![\\w/])/${escape(name)}\\b`).test(body)) deps.add(target)
    }
    self.deps = [...deps].sort()
    return self
  })
}
