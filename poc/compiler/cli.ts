// POC CLI. Usage: bun compiler/cli.ts --config <yaml> --project <dir> --mode copy|compile|guardian --target droid|claude --out <dir>
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'

import { emit, type Mode, MODES } from './emit'
import { loadSources } from './load'
import { budget, dedupe, defer, link, minify, normalize, treeShake } from './passes'
import { detectProfile } from './profile'
import type { CompileConfig } from './types'

const { values: a } = parseArgs({
  options: {
    config: { type: 'string' }, project: { type: 'string' }, out: { type: 'string' },
    mode: { type: 'string', default: 'compile' }, target: { type: 'string', default: 'droid' }, quiet: { type: 'boolean' },
  },
})
const cfgPath = resolve(a.config!)
const cfg = parseYaml(readFileSync(cfgPath, 'utf8')) as CompileConfig
for (const s of cfg.sources) s.path = resolve(dirname(cfgPath), s.path)
const mode = a.mode as Mode
const project = resolve(a.project!)
const out = resolve(a.out ?? project)

const t0 = performance.now()
const cs = loadSources(cfg.sources)
const profile = detectProfile(project, cfg.profile)
link(cs)
let overlaps: string[] = []
if (mode !== MODES.COPY) {
  normalize(cs, a.target!)
  overlaps = dedupe(cs)
  treeShake(cs, profile, cfg)
  defer(cs)
  minify(cs, cfg.minify?.descriptionChars ?? 1024)
  if (cfg.budget) budget(cs, cfg.budget)
}
const m = emit(cs, profile, { out, target: a.target!, mode, pin: cfg.pin ?? [], guardianDir: join(dirname(import.meta.path), '..', 'guardian') })
const ms = Math.round(performance.now() - t0)
if (!a.quiet) {
  console.log(`forge compile (POC) mode=${mode} target=${a.target} profile=[${profile.tags.join(', ')}] in ${ms}ms`)
  console.table(m.totals.byKind)
  console.log(`routing index estimate: ${m.totals.estimatedIndexTokens} tokens (skills ${m.totals.estimatedIndexTokensSkills}, agents ${m.totals.estimatedIndexTokensAgents}); files ${m.totals.filesWritten}`)
  console.log(`edges: ${cs.reduce((s, c) => s + c.deps.length, 0)}; near-duplicate routing pairs: ${overlaps.length}; diagnostics: ${cs.reduce((s, c) => s + c.diagnostics.length, 0)}`)
}
