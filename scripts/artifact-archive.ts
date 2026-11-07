import {inflateRawSync} from 'node:zlib'

import {evidencePath} from './evidence-schema'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'

/** Read selected provider ZIPs without extracting paths or running archive tools. */
export function artifactFiles(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Artifact archive oversized')
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i
      break
    }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6))
    throw new Error('Unsupported/malformed artifact ZIP')
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    central = bytes.readUInt32LE(end + 16)
  if (count > 1000 || central + centralSize !== end || bytes.readUInt16LE(end + 8) !== count)
    throw new Error('Invalid artifact directory')
  const files = new Map<string, Buffer>()
  let cursor = central,
    total = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid artifact entry')
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      size = bytes.readUInt32LE(cursor + 24),
      compressed = bytes.readUInt32LE(cursor + 20)
    const nameLength = bytes.readUInt16LE(cursor + 28),
      extra = bytes.readUInt16LE(cursor + 30),
      comment = bytes.readUInt16LE(cursor + 32),
      local = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (
      cursor + 46 + nameLength + extra + comment > end ||
      flags & 1 ||
      ((bytes.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('Unsafe artifact entry')
    cursor += 46 + nameLength + extra + comment
    evidencePath.parse(name.endsWith('/') ? name.slice(0, -1) : name)
    if (name.endsWith('/')) continue
    if (files.has(name) || size > MAX_EVIDENCE_BYTES || (total += size) > 20 * 1024 * 1024 || ![0, 8].includes(method))
      throw new Error('Unsupported/duplicate/oversized artifact member')
    if (local + 30 > central || bytes.readUInt32LE(local) !== 0x04034b50)
      throw new Error('Invalid local artifact header')
    const localName = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28),
      data = local + 30 + localName + localExtra
    if (bytes.subarray(local + 30, local + 30 + localName).toString() !== name || data + compressed > central)
      throw new Error('Artifact member mismatch')
    const body = bytes.subarray(data, data + compressed)
    const uncompressed = method === 0 ? body : inflateRawSync(body, {maxOutputLength: MAX_EVIDENCE_BYTES})
    if (uncompressed.length !== size) throw new Error('Truncated artifact member')
    files.set(name, uncompressed)
  }
  if (cursor !== end) throw new Error('Invalid artifact directory size')
  return files
}
