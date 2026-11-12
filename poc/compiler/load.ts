import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

import { type Component, type Kind, KINDS, type SourceConfig, STATUSES } from './types'

export const splitFrontmatter = (raw: string): { fm: Record<string, unknown>; body: string; error?: string } => {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { fm: {}, body: raw }
  try {
    const fm = parseYaml(m[1]) ?? {}
    return { fm: typeof fm === 'object' ? (fm as Record<string, unknown>) : {}, body: m[2] }
  } catch (e) {
    return { fm: {}, body: m[2], error: `frontmatter YAML: ${(e as Error).message.split('\n')[0]}` }
  }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const listDirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()) : [])
const listMd = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => n.endsWith('.md')) : [])

const toLabels = (fm: Record<string, unknown>): string[] => {
  const out: string[] = []
  const meta = (fm.metadata ?? {}) as Record<string, unknown>
  for (const v of [fm.tags, fm.keywords, fm.labels, fm.triggers, meta.labels, meta.tags, meta.triggers, fm.language]) {
    if (Array.isArray(v)) out.push(...v.map(String))
    else if (typeof v === 'string' && v !== '*') out.push(v)
  }
  return out.map((s) => s.toLowerCase())
}

const make = (
  kind: Kind,
  file: string,
  dir: string,
  ctx: { plugin: string; source: string; category?: string; pluginKeywords?: string[] },
  fallbackName: string,
): Component => {
  const raw = readFileSync(file, 'utf8')
  const { fm, body, error } = splitFrontmatter(raw)
  const name = String(fm.name ?? fallbackName)
  return {
    id: `${kind}:${name}`,
    kind,
    name,
    plugin: ctx.plugin,
    source: ctx.source,
    category: ctx.category,
    dir,
    file,
    frontmatter: fm,
    description: String(fm.description ?? '').replace(/\s+/g, ' ').trim(),
    body,
    hash: hash(body),
    labels: [...toLabels(fm), ...(ctx.pluginKeywords ?? [])],
    deps: [],
    status: STATUSES.KEPT,
    reasons: [],
    diagnostics: error ? [error] : [],
  }
}

const loadPluginDir = (
  pdir: string,
  ctx: { plugin: string; source: string; category?: string },
  agentDirs: string[],
): Component[] => {
  const out: Component[] = []
  const manifestPath = [join(pdir, '.claude-plugin/plugin.json'), join(pdir, '.factory-plugin/plugin.json')].find(existsSync)
  const manifest = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const pctx = { ...ctx, pluginKeywords: (manifest.keywords ?? []).map((k: string) => String(k).toLowerCase()) }
  for (const s of listDirs(join(pdir, 'skills'))) {
    const f = join(pdir, 'skills', s, 'SKILL.md')
    if (existsSync(f)) out.push(make(KINDS.SKILL, f, dirname(f), pctx, s))
  }
  for (const ad of agentDirs)
    for (const a of listMd(join(pdir, ad))) out.push(make(KINDS.AGENT, join(pdir, ad, a), join(pdir, ad), pctx, basename(a, '.md')))
  for (const c of listMd(join(pdir, 'commands')))
    out.push(make(KINDS.COMMAND, join(pdir, 'commands', c), join(pdir, 'commands'), pctx, basename(c, '.md')))
  for (const h of ['hooks/hooks.json']) {
    const f = join(pdir, h)
    if (existsSync(f)) out.push({ ...make(KINDS.HOOK, f, dirname(f), pctx, `${ctx.plugin}-hooks`), body: readFileSync(f, 'utf8') })
  }
  for (const m of ['.mcp.json', 'mcp.json']) {
    const f = join(pdir, m)
    if (existsSync(f)) out.push({ ...make(KINDS.MCP, f, pdir, pctx, `${ctx.plugin}-mcp`), body: readFileSync(f, 'utf8') })
  }
  return out
}

const loaders: Record<SourceConfig['type'], (s: SourceConfig) => Component[]> = {
  'claude-marketplace': (s) => {
    const m = JSON.parse(readFileSync(join(s.path, '.claude-plugin/marketplace.json'), 'utf8'))
    return m.plugins.flatMap((p: { name: string; source: string; category?: string }) =>
      typeof p.source === 'string'
        ? loadPluginDir(join(s.path, p.source), { plugin: p.name, source: s.name, category: p.category }, ['agents'])
        : [],
    )
  },
  'factory-marketplace': (s) => {
    const m = JSON.parse(readFileSync(join(s.path, '.factory-plugin/marketplace.json'), 'utf8'))
    return m.plugins.flatMap((p: { name: string; source: string; category?: string }) =>
      loadPluginDir(join(s.path, p.source), { plugin: p.name, source: s.name, category: p.category ?? 'workflows' }, ['droids', 'agents']),
    )
  },
  loose: (s) => {
    const ctx = { plugin: s.name, source: s.name, category: 'development' }
    const out = loadPluginDir(s.path, ctx, ['agents', 'droids'])
    for (const r of listMd(join(s.path, 'rules'))) out.push(make(KINDS.RULE, join(s.path, 'rules', r), join(s.path, 'rules'), ctx, basename(r, '.md')))
    return out
  },
}

export const loadSources = (sources: SourceConfig[]): Component[] => sources.flatMap((s) => loaders[s.type](s))
