import { readFileSync } from 'node:fs'

import { loadIndex, route } from '../guardian/router'

// Usage: bun eval/route-model-score.ts [bench-dir] [guardian-workspace]
const B = process.argv[2] ?? '/Users/smith/poc-scratch/bench/'
const prompts = JSON.parse(readFileSync(B + 'prompts.json', 'utf8'))
const index = loadIndex(process.argv[3] ?? '/tmp/fg')
const ans: Array<{ i: number; pick: string[]; query: string }> = []
for (const b of [0, 1, 2, 3]) {
  const r = JSON.parse(readFileSync(`${B}out${b}.json`, 'utf8')).result as string
  ans.push(...JSON.parse(r.slice(r.indexOf('['), r.lastIndexOf(']') + 1)))
}
const by = new Map(ans.map((a) => [a.i, a]))
const pct = (n: number, d: number) => `${((100 * n) / (d || 1)).toFixed(0)}% (${n}/${d})`
const out: Record<string, string> = {}
for (const [label, sel] of [
  ['haiku picks from catalog', (i: number) => by.get(i)?.pick ?? []],
  ['haiku query -> BM25', (i: number) => route(by.get(i)?.query ?? '', index).map((m) => m.name)],
] as const) {
  for (const style of ['direct', 'indirect']) {
    const s = prompts.map((p: any, i: number) => ({ ...p, i })).filter((p: any) => p.expected && p.style === style)
    out[`${label} top-1 ${style}`] = pct(s.filter((p: any) => sel(p.i)[0] === p.expected).length, s.length)
    out[`${label} top-3 ${style}`] = pct(s.filter((p: any) => sel(p.i).includes(p.expected)).length, s.length)
  }
  const neg = prompts.map((p: any, i: number) => ({ ...p, i })).filter((p: any) => !p.expected)
  out[`${label} false suggestion on no-skill prompts`] = pct(neg.filter((p: any) => sel(p.i).length > 0).length, neg.length)
}
// Threshold sweep for the deterministic router: precision/recall trade-off.
const sweep: string[] = []
for (const floor of [6, 10, 14, 18]) {
  let tp = 0, fpNeg = 0, abst = 0
  for (const p of prompts) {
    const m = route(p.prompt, index).filter((x) => x.score >= floor).map((x) => x.name)
    if (p.expected && m.includes(p.expected)) tp++
    if (!p.expected && m.length) fpNeg++
    if (p.expected && !m.length) abst++
  }
  sweep.push(`floor ${floor}: top-3 recall ${pct(tp, 80)}, false suggestion ${pct(fpNeg, 20)}, abstain on skill prompts ${pct(abst, 80)}`)
}
console.log(JSON.stringify(out, null, 1))
console.log(sweep.join('\n'))
