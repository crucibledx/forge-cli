// Minimal stdio MCP server (newline-delimited JSON-RPC): search_skills + load_skill over the compiled guardian index.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { loadIndex, route } from './router'

const project = process.env.GUARDIAN_PROJECT ?? process.cwd()
const index = loadIndex(project)
const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const text = (t: string) => ({ content: [{ type: 'text', text: t }] })

const TOOLS = [
  {
    name: 'search_skills',
    description: `Search ${index.length} installed skills that are not in your skill list. Returns names, descriptions and instruction paths.`,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'load_skill',
    description: 'Return the full instructions of an installed skill by exact name.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
]

const calls: Record<string, (a: Record<string, string>) => unknown> = {
  search_skills: (a) => {
    const m = route(a.query ?? '', index, 5)
    return text(m.length ? m.map((x) => `${x.name}: ${x.entry.description} (${join(project, x.entry.path)})`).join('\n') : 'No matching skills.')
  },
  load_skill: (a) => {
    const e = index.find((x) => x.name === a.name)
    return e ? text(readFileSync(join(project, e.path), 'utf8')) : { ...text(`Unknown skill: ${a.name}`), isError: true }
  },
}

const methods: Record<string, (p: Record<string, unknown>) => unknown> = {
  initialize: (p) => ({
    protocolVersion: (p.protocolVersion as string) ?? '2025-06-18',
    capabilities: { tools: {} },
    serverInfo: { name: 'skill-guardian', version: '0.0.0-poc' },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: TOOLS }),
  'tools/call': (p) => calls[p.name as string]?.((p.arguments ?? {}) as Record<string, string>) ?? { ...text('Unknown tool'), isError: true },
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.id === undefined) return // notification
  const fn = methods[msg.method]
  if (!fn) return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } })
  try {
    send({ jsonrpc: '2.0', id: msg.id, result: fn(msg.params ?? {}) })
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: (e as Error).message } })
  }
})
