// Summarizes eval/results/runs.jsonl per task and condition. Usage: bun eval/aggregate.ts [runs.jsonl]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Row = { cond: string; task: string; input: number; credits: number; ms: number; success: boolean; skillLoaded: boolean | null; session: string }

const file = process.argv[2] ?? join(import.meta.dir, 'results/runs.jsonl')
const rows: Row[] = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const root = join(homedir(), '.factory/sessions')
const transcript = (sid: string) => {
  for (const d of readdirSync(root)) {
    const f = join(root, d, `${sid}.jsonl`)
    if (existsSync(f)) return readFileSync(f, 'utf8')
  }
  return ''
}
const early = new Map(rows.map((r) => [r.session, transcript(r.session).includes('Exec ended early')]))
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const sd = (a: number[]) => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1))
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const k = (n: number) => `${Math.round(n / 1000)}k`
const CONDS = ['empty', 'copy', 'compile', 'guardian']

console.log('| Task | Condition | Success | Skill loaded | Input tokens mean ± sd | Credits mean ± sd | Credits median vs empty | Wall s mean | Early stops |')
console.log('|---|---|---|---|---|---|---|---|---|')
for (const t of ['T1', 'T2', 'T3', 'T4', 'all']) {
  const base = median(rows.filter((x) => x.cond === 'empty' && (t === 'all' || x.task === t)).map((x) => x.credits))
  for (const c of CONDS) {
    const r = rows.filter((x) => x.cond === c && (t === 'all' || x.task === t))
    const sk = r.filter((x) => x.skillLoaded !== null)
    const cr = r.map((x) => x.credits)
    console.log(
      `| ${t} | ${c} | ${r.filter((x) => x.success).length}/${r.length} | ${sk.length ? `${sk.filter((x) => x.skillLoaded).length}/${sk.length}` : 'n/a'} | ${k(mean(r.map((x) => x.input)))} ± ${k(sd(r.map((x) => x.input)))} | ${k(mean(cr))} ± ${k(sd(cr))} | ${(median(cr) / base).toFixed(2)}x | ${mean(r.map((x) => x.ms / 1000)).toFixed(0)} | ${r.filter((x) => early.get(x.session)).length} |`,
    )
  }
}
