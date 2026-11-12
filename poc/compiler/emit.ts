import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stringify } from 'yaml'

import { countTokens, indexEntry } from './tokens'
import { type Component, KINDS, type Profile, STATUSES } from './types'

export const MODES = { COPY: 'copy', COMPILE: 'compile', GUARDIAN: 'guardian' } as const
export type Mode = (typeof MODES)[keyof typeof MODES]

const LAYOUT: Record<string, Record<string, string>> = {
  droid: { skill: '.factory/skills', agent: '.factory/droids', command: '.factory/commands' },
  claude: { skill: '.claude/skills', agent: '.claude/agents', command: '.claude/commands' },
}

const render = (c: Component, extra: Record<string, unknown> = {}) =>
  `---\n${stringify({ ...c.frontmatter, ...extra }, { lineWidth: 0 }).trimEnd()}\n---\n${c.body}`

const writeSkill = (c: Component, dest: string, extra: Record<string, unknown> = {}) => {
  cpSync(c.dir, dest, { recursive: true })
  writeFileSync(join(dest, 'SKILL.md'), render(c, extra))
}

export interface EmitOptions {
  out: string
  target: string
  mode: Mode
  pin: string[]
  guardianDir: string
}

export const emit = (cs: Component[], profile: Profile, o: EmitOptions) => {
  const layout = LAYOUT[o.target]
  for (const d of Object.values(layout)) rmSync(join(o.out, d), { recursive: true, force: true })
  rmSync(join(o.out, '.crucible'), { recursive: true, force: true })
  const written: string[] = []
  const store = join(o.out, '.crucible/store')
  const guardianIndex: Array<Record<string, unknown>> = []

  for (const c of cs) {
    const emitted = o.mode === MODES.COPY ? c.status !== STATUSES.INVALID : c.status === STATUSES.KEPT || c.status === STATUSES.DEFERRED
    if (c.kind === KINDS.SKILL && o.mode === MODES.GUARDIAN && !o.pin.includes(c.name) && c.status !== STATUSES.INVALID && c.status !== STATUSES.DEDUPED) {
      const dest = join(store, c.name)
      writeSkill(c, dest)
      guardianIndex.push({ name: c.name, description: c.description, labels: c.labels, plugin: c.plugin, category: c.category, path: relative(o.out, join(dest, 'SKILL.md')), status: c.status })
      continue
    }
    if (!emitted || !layout[c.kind]) continue
    const base = join(o.out, layout[c.kind])
    mkdirSync(base, { recursive: true })
    if (c.kind === KINDS.SKILL) {
      const dest = join(base, c.name)
      writeSkill(c, dest, c.status === STATUSES.DEFERRED && o.mode !== MODES.COPY ? { 'disable-model-invocation': true } : {})
      written.push(relative(o.out, dest))
    } else {
      const f = join(base, `${c.name}.md`)
      writeFileSync(f, render(c))
      written.push(relative(o.out, f))
    }
  }

  if (o.mode === MODES.GUARDIAN) {
    mkdirSync(join(o.out, '.crucible'), { recursive: true })
    writeFileSync(join(o.out, '.crucible/guardian-index.json'), JSON.stringify(guardianIndex, null, 1))
    mkdirSync(join(o.out, '.factory'), { recursive: true })
    const hook = `bun ${join(o.guardianDir, 'hook.ts')}`
    writeFileSync(
      join(o.out, '.factory/hooks.json'),
      JSON.stringify({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: hook, timeout: 5 }] }] }, null, 2),
    )
    writeFileSync(
      join(o.out, '.factory/mcp.json'),
      JSON.stringify({ mcpServers: { 'skill-guardian': { type: 'stdio', command: 'bun', args: [join(o.guardianDir, 'mcp.ts')], env: { GUARDIAN_PROJECT: o.out } } } }, null, 2),
    )
  }

  const idx = (c: Component) => countTokens(indexEntry(c.name, c.description))
  const routable = (c: Component) => c.kind === KINDS.SKILL || c.kind === KINDS.AGENT
  const inIndex = (c: Component) => {
    if (!routable(c) || c.status === STATUSES.INVALID) return false
    if (o.mode === MODES.COPY) return true
    if (c.kind === KINDS.SKILL && o.mode === MODES.GUARDIAN) return o.pin.includes(c.name) && c.status !== STATUSES.DEDUPED
    return c.status === STATUSES.KEPT
  }
  const count = (k: string, s?: string) => cs.filter((c) => c.kind === k && (!s || c.status === s)).length
  const manifest = {
    poc: 'forge compiler POC, not a product format',
    target: o.target,
    mode: o.mode,
    profile,
    totals: {
      components: cs.length,
      byKind: Object.fromEntries(Object.values(KINDS).map((k) => [k, Object.fromEntries(Object.values(STATUSES).map((s) => [s, count(k, s)]))])),
      estimatedIndexTokens: cs.filter(inIndex).reduce((s, c) => s + idx(c), 0),
      estimatedIndexTokensSkills: cs.filter((c) => inIndex(c) && c.kind === KINDS.SKILL).reduce((s, c) => s + idx(c), 0),
      estimatedIndexTokensAgents: cs.filter((c) => inIndex(c) && c.kind === KINDS.AGENT).reduce((s, c) => s + idx(c), 0),
      filesWritten: written.length,
    },
    components: cs.map((c) => ({
      id: c.id, plugin: c.plugin, source: c.source, category: c.category, status: c.status, inIndex: inIndex(c),
      hash: c.hash, deps: c.deps, reasons: c.reasons, diagnostics: c.diagnostics,
      indexTokens: routable(c) ? idx(c) : 0, bodyTokens: countTokens(c.body),
    })),
  }
  mkdirSync(join(o.out, '.crucible'), { recursive: true })
  writeFileSync(join(o.out, '.crucible/forge.manifest.json'), JSON.stringify(manifest, null, 1))
  return manifest
}
