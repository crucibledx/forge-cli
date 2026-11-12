// POC eval runner: same tasks, same model, fresh workspace per run. Usage: bun eval/run.ts [reps] [concurrency] [filter]
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { guardianNote } from '../guardian/router'

const POC = join(import.meta.dir, '..')
const RUNS = '/Users/smith/poc-scratch/runs'
const OUT = join(import.meta.dir, 'results/runs.jsonl')
const MODEL = process.env.EVAL_MODEL ?? 'claude-sonnet-5'
const AUTO = process.env.EVAL_AUTO ?? 'low'
const [reps = 3, conc = 4] = process.argv.slice(2, 4).map(Number)
const filter = process.argv[4] ?? ''

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const pyFiles = (ws: string) =>
  spawnSync('find', [ws, '-name', '*.py', '-not', '-path', '*/.crucible/*', '-not', '-path', '*/.factory/*'], { encoding: 'utf8' })
    .stdout.split('\n').filter(Boolean).map(read).join('\n')

export const TASKS: Record<string, { prompt: string; skill: string | null; check: (ws: string) => { ok: boolean; detail: string } }> = {
  T1: {
    prompt: "Detect and classify this project's tech stack and write the classification to STACK.md.",
    skill: 'detect-stack',
    check: (ws) => {
      const s = read(join(ws, 'STACK.md'))
      const keys = ['Language', 'Framework', 'Build', 'Package Manager'].filter((k) => new RegExp(`^[\\s>*-]*\\**${k}\\**\\s*:`, 'mi').test(s))
      return { ok: keys.length === 4, detail: `classification keys ${keys.length}/4` }
    },
  },
  T2: {
    prompt: 'Fill in the Acceptance contract section of specs/0007-order-cancellation.md.',
    skill: 'acceptance-contract',
    check: (ws) => {
      const s = read(join(ws, 'specs/0007-order-cancellation.md'))
      const rows = s.split('\n').filter((l) => /^\|\s*\**AC-\d+/.test(l))
      const typed = rows.filter((l) => /\|\s*`?(test|cli snapshot|e2e|screenshot|doc)`?\s*[|:]/i.test(l))
      const ok = rows.length >= 10 && rows.length <= 40 && typed.length >= rows.length * 0.8
      return { ok, detail: `AC rows ${rows.length}, typed ${typed.length}` }
    },
  },
  T3: {
    prompt: 'Add a GET /orders endpoint to app/main.py that lists all orders sorted by id.',
    skill: null,
    check: (ws) => {
      const s = read(join(ws, 'app/main.py'))
      const compiles = spawnSync('python3', ['-m', 'py_compile', join(ws, 'app/main.py')]).status === 0
      const ok = compiles && /@app\.get\(\s*["']\/orders["']/.test(s) && /@app\.get\(\s*["']\/orders\/\{order_id\}["']/.test(s)
      return { ok, detail: `compiles ${compiles}` }
    },
  },
  T4: {
    prompt: 'Add a Stripe webhook endpoint POST /webhooks/stripe that verifies the signature and marks the order paid when checkout.session.completed arrives.',
    skill: 'stripe-integration',
    check: (ws) => {
      const s = pyFiles(ws)
      const parts = { verify: /construct_event|compare_digest/.test(s), route: /\/webhooks\/stripe/.test(s), event: /checkout\.session\.completed/.test(s) }
      return { ok: Object.values(parts).every(Boolean), detail: JSON.stringify(parts) }
    },
  },
}
const CONDITIONS = ['empty', 'copy', 'compile', 'guardian'] as const

const transcript = (sid: string) => {
  const root = join(homedir(), '.factory/sessions')
  for (const d of readdirSync(root)) {
    const f = join(root, d, `${sid}.jsonl`)
    if (existsSync(f)) return read(f)
  }
  return ''
}
const skillLoaded = (t: string, skill: string) => {
  const calls: string[] = []
  for (const line of t.split('\n')) {
    if (!line) continue
    const d = JSON.parse(line)
    if (d.type !== 'message' || d.message.role !== 'assistant') continue
    for (const c of d.message.content ?? []) if (c.type === 'tool_use') calls.push(JSON.stringify(c.input ?? {}))
  }
  const all = calls.join('\n')
  return new RegExp(`${skill}/SKILL\\.md|"skill"\\s*:\\s*"${skill}"|load_skill[^\\n]*${skill}|/${skill}\\b`).test(all)
}

const one = async (cond: string, task: string, rep: number) => {
  const ws = join(RUNS, `${cond}-${task}-${rep}`)
  rmSync(ws, { recursive: true, force: true })
  mkdirSync(RUNS, { recursive: true })
  spawnSync('cp', ['-R', join(POC, 'eval/fixture'), ws])
  if (cond !== 'empty')
    spawnSync('bun', [join(POC, 'compiler/cli.ts'), '--quiet', '--config', join(POC, 'eval/forge.compile.yaml'), '--project', ws, '--mode', cond], { cwd: POC })
  mkdirSync(join(ws, '.factory'), { recursive: true })
  writeFileSync(join(ws, '.factory/settings.json'), JSON.stringify({ enabledPlugins: { 'crucible-loop@factory-loop': false } }))
  spawnSync('sh', ['-c', 'git init -q && git add -A && git -c commit.gpgsign=false commit -qm fixture'], { cwd: ws })
  const t = TASKS[task]
  // droid exec (1.8.0) does not fire UserPromptSubmit hooks, so the runner appends the hook's output itself.
  const g = cond === 'guardian' ? guardianNote(t.prompt, ws) : { note: '', matches: [] }
  const prompt = g.note ? `${t.prompt}\n\n${g.note}` : t.prompt
  const t0 = Date.now()
  const proc = Bun.spawn(['droid', 'exec', '-o', 'json', '-m', MODEL, '--auto', AUTO, prompt], { cwd: ws, stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => proc.kill(), 15 * 60_000)
  const out = await new Response(proc.stdout).text()
  clearTimeout(timer)
  let res: Record<string, any> = {}
  try {
    res = JSON.parse(out.slice(out.indexOf('{')))
  } catch {
    res = { is_error: true, result: out.slice(0, 300) }
  }
  const u = res.usage ?? {}
  const check = t.check(ws)
  const tr = res.session_id ? transcript(res.session_id) : ''
  const row = {
    cond, task, rep, model: MODEL, auto: AUTO, session: res.session_id, error: !!res.is_error, turns: res.num_turns, ms: Date.now() - t0,
    input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens, credits: u.factory_credits,
    success: check.ok, detail: check.detail, skillLoaded: t.skill ? skillLoaded(tr, t.skill) : null,
    guardian: cond === 'guardian' ? g.matches.map((m) => m.name) : undefined,
  }
  appendFileSync(OUT, `${JSON.stringify(row)}\n`)
  console.log(`${cond} ${task} #${rep}: ok=${row.success} skill=${row.skillLoaded} in=${row.input} credits=${row.credits} ${Math.round(row.ms / 1000)}s`)
}

if (import.meta.main) {
  mkdirSync(join(import.meta.dir, 'results'), { recursive: true })
  const jobs: Array<() => Promise<void>> = []
  for (let rep = 1; rep <= reps; rep++)
    for (const task of Object.keys(TASKS))
      for (const cond of CONDITIONS) if (`${cond}-${task}`.includes(filter)) jobs.push(() => one(cond, task, rep))
  let next = 0
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < jobs.length) await jobs[next++]().catch((e) => console.error(e))
  }))
  console.log('done', jobs.length)
}
