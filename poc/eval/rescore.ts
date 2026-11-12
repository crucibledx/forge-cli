// Re-applies the current TASKS checks to existing run workspaces. Usage: bun eval/rescore.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TASKS } from './run'

const OUT = join(import.meta.dir, 'results/runs.jsonl')
const rows = readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
for (const r of rows) {
  const c = TASKS[r.task].check(join('/Users/smith/poc-scratch/runs', `${r.cond}-${r.task}-${r.rep}`))
  if (c.ok !== r.success) console.log(`${r.cond} ${r.task} #${r.rep}: ${r.success} -> ${c.ok} (${c.detail})`)
  Object.assign(r, { success: c.ok, detail: c.detail })
}
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
