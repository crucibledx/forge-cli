// Offline routing benchmark on held-out prompts. Usage: bun eval/route-bench.ts <guardian-workspace> <prompts.json> <compile-manifest> <copy-visible.json>
import { readFileSync } from 'node:fs'

import { route, loadIndex } from '../guardian/router'

const [ws, promptsPath, manifestPath, visiblePath] = process.argv.slice(2)
const prompts: Array<{ prompt: string; expected: string | null; style: string }> = JSON.parse(readFileSync(promptsPath, 'utf8'))
const index = loadIndex(ws)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const keptInListing = new Set(manifest.components.filter((c: any) => c.inIndex && c.id.startsWith('skill:')).map((c: any) => c.id.slice(6)))
const copyVisible = new Set<string>(JSON.parse(readFileSync(visiblePath, 'utf8')))

const rows = prompts.map((p) => {
  const t0 = performance.now()
  const m = route(p.prompt, index)
  const ms = performance.now() - t0
  const names = m.map((x) => x.name)
  return { ...p, names, ms, top1: p.expected ? names[0] === p.expected : null, top3: p.expected ? names.includes(p.expected) : null, abstain: names.length === 0 }
})
const pct = (n: number, d: number) => `${((100 * n) / (d || 1)).toFixed(0)}% (${n}/${d})`
const pos = rows.filter((r) => r.expected)
const neg = rows.filter((r) => !r.expected)
const out: Record<string, string> = {}
for (const style of ['direct', 'indirect']) {
  const s = pos.filter((r) => r.style === style)
  out[`router top-1 ${style}`] = pct(s.filter((r) => r.top1).length, s.length)
  out[`router top-3 ${style}`] = pct(s.filter((r) => r.top3).length, s.length)
  out[`router abstained ${style}`] = pct(s.filter((r) => r.abstain).length, s.length)
}
out['router top-3 all'] = pct(pos.filter((r) => r.top3).length, pos.length)
out['router false suggestion on no-skill prompts'] = pct(neg.filter((r) => !r.abstain).length, neg.length)
out['router suggested wrong skill (no expected in top-3, not abstained)'] = pct(pos.filter((r) => !r.top3 && !r.abstain).length, pos.length)
out['router latency p50/max ms'] = (() => {
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b)
  return `${ms[Math.floor(ms.length / 2)].toFixed(2)} / ${ms[ms.length - 1].toFixed(2)}`
})()
const expectedSkills = [...new Set(pos.map((r) => r.expected!))]
out['copy-all: expected skill has a visible description'] = pct(expectedSkills.filter((s) => copyVisible.has(s)).length, expectedSkills.length)
out['compiled: expected skill kept in listing'] = pct(expectedSkills.filter((s) => keptInListing.has(s)).length, expectedSkills.length)
console.log(JSON.stringify(out, null, 1))
console.log('MISSES:')
for (const r of pos.filter((r) => !r.top3)) console.log(`  [${r.style}] ${r.expected} <- ${JSON.stringify(r.names)} :: ${r.prompt.slice(0, 110)}`)
console.log('FALSE POSITIVES:')
for (const r of neg.filter((r) => !r.abstain)) console.log(`  ${JSON.stringify(r.names)} :: ${r.prompt.slice(0, 110)}`)
