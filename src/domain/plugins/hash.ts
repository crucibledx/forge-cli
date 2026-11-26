import {createHash} from 'node:crypto'

import type {DeliveredFiles, PluginFile} from './types'

/*
 * The `computedHash` of Vercel's `skills` lock (skills-lock.json v2, vercel-labs/skills src/skill-hash.ts, MIT),
 * adopted verbatim: excluded names are never read, files sort by the UTF-8 bytes of their `/` paths, each is framed
 * as `path NUL length NUL content`, and text files (no NUL byte) hash with CRLF turned into LF.
 */
const EXCLUDED_FILES = new Set(['metadata.json'])
const EXCLUDED_DIRS = new Set(['.git', '__pycache__', '__pypackages__'])

export function isHashExcluded(name: string, isDirectory: boolean): boolean {
  return EXCLUDED_FILES.has(name) || (isDirectory && EXCLUDED_DIRS.has(name))
}

function normalizeLineEndings(content: Buffer): Buffer {
  if (content.includes(0) || !content.includes('\r\n')) return content
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')
}

export function hashPluginFiles(files: readonly PluginFile[]): string {
  const entries = files
    .map((file) => ({path: Buffer.from(file.path, 'utf8'), content: normalizeLineEndings(Buffer.from(file.content))}))
    .sort((a, b) => Buffer.compare(a.path, b.path))
  const hash = createHash('sha256')
  for (const {path, content} of entries) {
    hash.update(path)
    hash.update('\0')
    hash.update(String(content.length))
    hash.update('\0')
    hash.update(content)
  }
  return hash.digest('hex')
}

/** `outputs[<harness>]`: the same hash over every delivered file, keyed by a scope-independent destination. */
export function hashDelivered(delivered: DeliveredFiles): string {
  return hashPluginFiles([
    ...delivered.plugin.map((file) => ({path: `plugin/${file.path}`, content: file.content})),
    ...(delivered.claudeRules ?? []).map((file) => ({path: `claude-rules/${file.path}`, content: file.content})),
  ])
}
