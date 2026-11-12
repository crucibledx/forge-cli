import { indexEntry, countTokens } from './tokens'
import { TECH } from './profile'
import { type Component, type CompileConfig, KINDS, type Profile, STATUSES } from './types'

const STOP = new Set(
  'a an and or the of for to in on with use when using this that is are be by as from at it its into your you via any all build create implement master expert'.split(' '),
)
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2 && !STOP.has(w)))
const jaccard = (a: Set<string>, b: Set<string>) => {
  let i = 0
  for (const x of a) if (b.has(x)) i++
  return i / (a.size + b.size - i || 1)
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const live = (c: Component) => c.status !== STATUSES.DEDUPED && c.status !== STATUSES.INVALID

// PASS: link. Build dependency edges from declared requires, subagent references, and explicit skill mentions.
export const link = (cs: Component[]) => {
  const byName = new Map<string, Component>()
  for (const c of cs) {
    byName.set(c.name, c)
    byName.set(`${c.plugin}::${c.file.split('/').pop()!.replace(/\.md$/, '')}`, c)
  }
  const named = cs.filter((c) => c.kind !== KINDS.HOOK && c.kind !== KINDS.MCP && c.name.split('-').length >= 2)
  for (const c of cs) {
    const deps = new Set<string>()
    const req = c.frontmatter.requires
    for (const r of Array.isArray(req) ? req : []) {
      const t = byName.get(String(r).replace(/^\//, ''))
      if (t) deps.add(t.id)
      else c.diagnostics.push(`unresolved requires: ${r}`)
    }
    for (const m of c.body.matchAll(/subagent_type\s*[=:]\s*["']([^"']+)["']/g)) {
      const t = byName.get(m[1]) ?? byName.get(m[1].split('::').pop()!)
      if (t) deps.add(t.id)
    }
    for (const o of named) {
      if (o === c) continue
      const re = new RegExp(`(?:[/\`]${escape(o.name)}\\b|\\b${escape(o.name)}\\s+(?:skill|droid|subagent|agent))`)
      if (re.test(c.body)) deps.add(o.id)
    }
    c.deps = [...deps]
  }
}

// PASS: normalize for a target harness. Makes components valid where the target is stricter than the source.
const CLAUDE_TO_DROID_TOOLS: Record<string, string> = {
  Read: 'Read', Edit: 'Edit', MultiEdit: 'Edit', Write: 'Create', Bash: 'Execute', Grep: 'Grep', Glob: 'Glob', LS: 'LS',
  WebFetch: 'FetchUrl', WebSearch: 'WebSearch', Task: 'Task', TodoWrite: 'TodoWrite',
}
export const normalize = (cs: Component[], target: string) => {
  for (const c of cs) {
    if ((c.kind === KINDS.SKILL || c.kind === KINDS.AGENT) && !c.description) {
      c.status = STATUSES.INVALID
      c.reasons.push('missing description: harness cannot route to it')
      continue
    }
    if (c.kind === KINDS.SKILL && !c.frontmatter.name) {
      c.frontmatter.name = c.name
      c.diagnostics.push('added missing `name` (required by Droid/Agent Skills)')
    }
    if (target === 'droid' && c.kind === KINDS.AGENT) {
      const model = c.frontmatter.model
      if (model !== undefined && model !== 'inherit') {
        c.frontmatter.model = 'inherit'
        c.diagnostics.push(`model "${model}" is a Claude alias; mapped to inherit`)
      }
      const tools = c.frontmatter.tools
      if (tools !== undefined) {
        const list = (Array.isArray(tools) ? tools : String(tools).split(',')).map((t) => String(t).trim()).filter(Boolean)
        const mapped = [...new Set(list.map((t) => CLAUDE_TO_DROID_TOOLS[t]).filter(Boolean))]
        const dropped = list.filter((t) => !CLAUDE_TO_DROID_TOOLS[t])
        if (dropped.length) c.diagnostics.push(`dropped tools with no Droid equivalent: ${dropped.join(', ')}`)
        if (mapped.length) c.frontmatter.tools = mapped
        else delete c.frontmatter.tools
      }
    }
  }
}

// PASS: dedupe. Exact body duplicates are removed; name clashes are renamed; near-duplicate routing text is reported.
export const dedupe = (cs: Component[]) => {
  const aliases = new Map<Component, Component>()
  const seen = new Map<string, Component>()
  const ids = new Map<string, Component>()
  for (const c of cs.filter(live)) {
    const key = `${c.kind}:${c.hash}`
    const first = seen.get(key)
    if (first) {
      c.status = STATUSES.DEDUPED
      c.reasons.push(`identical body to ${first.id} (${first.plugin})`)
      aliases.set(c, first)
      continue
    }
    seen.set(key, c)
    if (ids.has(c.id)) {
      c.diagnostics.push(`name clash with ${ids.get(c.id)!.plugin}; renamed`)
      c.name = `${c.plugin}-${c.name}`
      c.frontmatter.name = c.name
      c.id = `${c.kind}:${c.name}`
    }
    ids.set(c.id, c)
  }
  // Rewrite references to removed duplicates so commands and agents still resolve after dedupe.
  const byId = new Map([...aliases].map(([d, k]) => [d.id, k]))
  for (const c of cs.filter(live)) {
    c.deps = [...new Set(c.deps.map((d) => byId.get(d)?.id ?? d))]
    for (const [d, k] of aliases) {
      const ref = `${d.plugin}::${d.file.split('/').pop()!.replace(/\.md$/, '')}`
      if (c.body.includes(ref) || c.body.includes(d.name)) {
        c.body = c.body.split(ref).join(k.name).replace(new RegExp(`\\b${escape(d.name)}\\b`, 'g'), k.name)
        c.diagnostics.push(`rewrote reference ${d.name} -> ${k.name}`)
      }
    }
  }
  const routable = cs.filter((c) => live(c) && (c.kind === KINDS.SKILL || c.kind === KINDS.AGENT))
  const sets = routable.map((c) => words(`${c.name.replace(/-/g, ' ')} ${c.description}`))
  const overlaps: string[] = []
  for (let i = 0; i < routable.length; i++)
    for (let j = i + 1; j < routable.length; j++) {
      const s = jaccard(sets[i], sets[j])
      if (s >= 0.5) {
        overlaps.push(`${routable[i].id} ~ ${routable[j].id} (${s.toFixed(2)})`)
        routable[j].diagnostics.push(`routing overlap with ${routable[i].id} (jaccard ${s.toFixed(2)})`)
      }
    }
  return overlaps
}

const AMBIGUOUS = new Set(['go', 'uv', 'node', 'game', 'vector', 'schema', 'sql', 'database', 'migration', 'migrations', 'diagram', 'container', 'containers', 'mobile', 'swift', 'unity', 'payment', 'billing', 'lambda', 'iac', 'rag', 'embedded', 'c#', 'bun', 'deno', 'npm', 'spring', 'phoenix', 'rails', 'cortex', 'helm', 'pip', 'llm'])
const techOf = (c: Component): string[] => {
  const strong = ` ${[c.name.replace(/-/g, ' '), c.plugin.replace(/-/g, ' '), ...c.labels].join(' ').toLowerCase()} `
  const weak = ` ${c.description.toLowerCase()} `
  const hits = (text: string, skipAmbiguous: boolean) => {
    const out = new Set<string>()
    for (const [tech, terms] of Object.entries(TECH))
      for (const t of terms)
        if (!(skipAmbiguous && AMBIGUOUS.has(t)) && new RegExp(`[^a-z0-9]${escape(t)}[^a-z0-9]`).test(text)) out.add(tech)
    return [...out]
  }
  // Name and labels say what a component is about; the description only decides when they are silent.
  const named = hits(strong, false)
  return named.length ? named : hits(weak, true)
}

// PASS: tree-shake. Roots are components relevant to the project profile; dependencies of roots are kept transitively.
export const treeShake = (cs: Component[], profile: Profile, cfg: CompileConfig) => {
  const allow = new Set(cfg.categories?.allow ?? [])
  const keep = new Set(cfg.keep ?? [])
  const byId = new Map(cs.map((c) => [c.id, c]))
  const roots: Component[] = []
  for (const c of cs.filter(live)) {
    if (c.kind === KINDS.HOOK || c.kind === KINDS.MCP) {
      roots.push(c)
      continue
    }
    const tech = techOf(c)
    const matched = tech.filter((t) => profile.tags.includes(t))
    if (keep.has(c.name)) {
      c.reasons.push('pinned by config keep')
      roots.push(c)
    } else if (allow.size && c.category && !allow.has(c.category)) {
      c.status = STATUSES.SHAKEN
      c.reasons.push(`category "${c.category}" not allowed for this project`)
    } else if (tech.length && !matched.length) {
      c.status = STATUSES.SHAKEN
      c.reasons.push(`technology [${tech.join(', ')}] not in project profile`)
    } else {
      c.reasons.push(matched.length ? `matches profile [${matched.join(', ')}]` : 'technology-neutral')
      roots.push(c)
    }
  }
  const stack = [...roots]
  while (stack.length) {
    const c = stack.pop()!
    for (const d of c.deps) {
      const t = byId.get(d)
      if (t && t.status === STATUSES.SHAKEN) {
        t.status = STATUSES.KEPT
        t.reasons.push(`kept: dependency of ${c.id}`)
        stack.push(t)
      }
    }
  }
}

// PASS: defer. Shaken skills stay installed but out of the model's routing index (user-invocable only).
export const defer = (cs: Component[]) => {
  for (const c of cs) if (c.kind === KINDS.SKILL && c.status === STATUSES.SHAKEN) c.status = STATUSES.DEFERRED
}

// PASS: minify routing text. Keeps the first sentence and the "Use when/for ..." trigger sentence.
export const minifyDescription = (d: string, max: number) => {
  if (d.length <= max) return d
  const sentences = d.split(/(?<=[.!?])\s+/)
  const trigger = sentences.slice(1).find((s) => /^use\b/i.test(s))
  let out = [sentences[0], trigger].filter(Boolean).join(' ')
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`
  return out
}
export const minify = (cs: Component[], max: number) => {
  for (const c of cs)
    if ((c.kind === KINDS.SKILL || c.kind === KINDS.AGENT) && c.description.length > max) {
      const before = c.description.length
      c.description = minifyDescription(c.description, max)
      c.frontmatter.description = c.description
      c.diagnostics.push(`description minified ${before}→${c.description.length} chars`)
    }
}

// PASS: budget. Harnesses cap the always-loaded listing (Droid: ~15k chars of skills, ~11k chars of droids) and drop or
// truncate descriptions past the cap in an order unrelated to relevance. Fit the listing so relevant entries keep theirs.
export const budget = (cs: Component[], b: { skillChars?: number; agentChars?: number; agentDescChars?: number }) => {
  const dependents = new Map<string, number>()
  for (const c of cs) for (const d of c.deps) dependents.set(d, (dependents.get(d) ?? 0) + 1)
  const score = (c: Component) =>
    (c.reasons.some((r) => r.startsWith('pinned')) ? 1000 : 0) + (c.reasons.some((r) => r.startsWith('matches')) ? 10 : 0) + (dependents.get(c.id) ?? 0)
  const kept = (k: string) => cs.filter((c) => c.status === STATUSES.KEPT && c.kind === k).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
  const skillEntry = (c: Component) => c.name.length + 3 + Math.min(c.description.length, 200)
  let used = 0
  for (const c of kept(KINDS.SKILL)) {
    if (b.skillChars && used + skillEntry(c) > b.skillChars) {
      c.status = STATUSES.DEFERRED
      c.reasons.push(`deferred: skill listing budget ${b.skillChars} chars`)
    } else used += skillEntry(c)
  }
  if (b.agentChars) {
    const per = (c: Component) => c.name.length + 25 + (b.agentDescChars ?? 120)
    let a = 0
    for (const c of kept(KINDS.AGENT)) {
      if (a + per(c) > b.agentChars) {
        c.status = STATUSES.SHAKEN
        c.reasons.push(`dropped: droid listing budget ${b.agentChars} chars at ${b.agentDescChars ?? 120} chars/description`)
      } else a += per(c)
    }
  }
  return used
}
