// Droid/Claude Code UserPromptSubmit hook. stdout (exit 0) is appended to the user's message, after the cached prefix.
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { guardianNote } from './router'

const t0 = performance.now()
let prompt = ''
try {
  prompt = JSON.parse(readFileSync(0, 'utf8')).prompt ?? ''
} catch {
  process.exit(0) // fail open: never block the user's prompt
}
const project = process.env.FACTORY_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const { note, matches } = guardianNote(prompt, project)
try {
  appendFileSync(
    join(project, '.crucible/guardian.log'),
    `${JSON.stringify({ at: new Date().toISOString(), ms: +(performance.now() - t0).toFixed(1), prompt: prompt.slice(0, 120), selected: matches.map((m) => [m.name, +m.score.toFixed(2), m.why]) })}\n`,
  )
} catch {}
if (note) console.log(note)
