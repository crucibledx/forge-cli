// Deterministic skill router: explicit mentions, then BM25 over name/labels/description. No model calls, no embeddings.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface IndexEntry {
  name: string
  description: string
  labels: string[]
  plugin: string
  category?: string
  path: string
}
export interface Match {
  name: string
  score: number
  why: string
  entry: IndexEntry
}

const STOP = new Set(
  'a an and or the of for to in on with use when using this that is are be by as from at it its into your you via any all can should would could please i we me my our do does did make add write need want help how what which'.split(' '),
)
// Crude suffix stripping keeps matching deterministic and dependency-free.
const stem = (w: string) => w.replace(/(ing|ings|ed|es|s)$/, '').replace(/(ation|ations)$/, 'ate')
export const tokenize = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem)

const FIELDS: Array<[keyof IndexEntry | 'nameWords', number]> = [
  ['nameWords', 3],
  ['labels', 2],
  ['plugin', 1],
  ['description', 1],
]

export const loadIndex = (project: string): IndexEntry[] => {
  const p = join(project, '.crucible/guardian-index.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
}

export const route = (prompt: string, index: IndexEntry[], k = 3): Match[] => {
  const explicit = index.filter((e) => new RegExp(`(^|[^a-z0-9-])/?${e.name}([^a-z0-9-]|$)`, 'i').test(prompt))
  if (explicit.length) return explicit.map((e) => ({ name: e.name, score: 99, why: 'explicit mention', entry: e }))

  const docs = index.map((e) => {
    const tf = new Map<string, number>()
    for (const [f, w] of FIELDS) {
      const text = f === 'nameWords' ? e.name.replace(/-/g, ' ') : Array.isArray(e[f]) ? (e[f] as string[]).join(' ') : String(e[f] ?? '')
      for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + w)
    }
    return { e, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) }
  })
  const avg = docs.reduce((s, d) => s + d.len, 0) / (docs.length || 1)
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const q = [...new Set(tokenize(prompt))]
  const k1 = 1.2
  const b = 0.75
  const scored = docs
    .map((d) => {
      let s = 0
      const hits: string[] = []
      for (const t of q) {
        const f = d.tf.get(t)
        if (!f) continue
        const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
        s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg))
        hits.push(t)
      }
      return { name: d.e.name, score: s, why: `bm25 terms [${hits.join(', ')}]`, entry: d.e, nhits: hits.length }
    })
    .filter((m) => m.nhits >= 2)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  if (!scored.length) return []
  const top = scored[0].score
  // Absolute floor avoids suggesting anything for prompts that match no skill well; relative floor keeps the list short.
  return scored.filter((m) => m.score >= Math.max(6, top * 0.6)).slice(0, k).map(({ nhits: _, ...m }) => m)
}

export const guardianNote = (prompt: string, project: string): { note: string; matches: Match[] } => {
  const matches = route(prompt, loadIndex(project))
  if (!matches.length) return { note: '', matches }
  const lines = matches.map((m) => `- ${m.name}: ${m.entry.description}\n  Instructions: ${join(project, m.entry.path)}`)
  return {
    matches,
    note: `[skill-guardian] These installed skills match this request. They are not in your skill list; to use one, Read its instructions file and follow it.\n${lines.join('\n')}\nIf none fit, ignore this note, or call the skill-guardian search_skills tool with a short query.`,
  }
}
