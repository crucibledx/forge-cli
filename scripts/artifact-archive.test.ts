import {deflateRawSync} from 'node:zlib'

import {expect, it} from 'bun:test'

import {artifactFiles} from './artifact-archive'
import {commandLog, commandMetadata} from './validation-process'

function zip(
  names = ['checks/e2e/test-e2e.log'],
  method = 0,
  flags = 0,
  mode = 0,
  body = Buffer.from('selected evidence'),
) {
  const locals: Buffer[] = [],
    entries: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const filename = Buffer.from(name),
      compressed = method === 8 ? deflateRawSync(body) : body
    const header = Buffer.alloc(30),
      central = Buffer.alloc(46)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(flags, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(body.length, 22)
    header.writeUInt16LE(filename.length, 26)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(filename.length, 28)
    central.writeUInt32LE((mode * 65536) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    const local = Buffer.concat([header, filename, compressed])
    locals.push(local)
    offset += local.length
    entries.push(Buffer.concat([central, filename]))
  }
  const directory = Buffer.concat(entries),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
it.each([0, 8])(
  'AC-25,27 serialized diagnostic maximum authenticates ZIP method %s without raising limits',
  (method) => {
    const text = '\0'.repeat(256 * 1024)
    const log = commandLog(['bun', 'run', 'test:unit'], {
      ...commandMetadata(),
      seed: text,
      replay: text,
      stdout: text + 'visible-out',
      stderr: text + 'visible-err',
      reason: 'primary failure ' + text,
      exit_code: 1,
      duration_ms: 1,
      timed_out: false,
    })
    expect(Buffer.byteLength(log)).toBeLessThanOrEqual(2 * 1024 * 1024)
    const archived = artifactFiles(zip(['checks/business/test-unit.log'], method, 0, 0, Buffer.from(log)))
    const parsed = JSON.parse(archived.get('checks/business/test-unit.log')!.toString())
    expect(parsed).toMatchObject({command: ['bun', 'run', 'test:unit'], exit_code: 1, cwd: '.', signal: null})
    expect(parsed.stdout).toEndWith('visible-out')
    expect(parsed.stderr).toEndWith('visible-err')
    expect(parsed.seed).toEndWith('[truncated]')
    expect(parsed.replay).toEndWith('[truncated]')
    expect(parsed.reason).toStartWith('primary failure ')
  },
)
it.each([0, 8])('reads selected e2e artifact bytes with ZIP method %s without extracting paths', (method) => {
  expect(artifactFiles(zip(undefined, method)).get('checks/e2e/test-e2e.log')?.toString()).toBe('selected evidence')
})
it('rejects unsafe, duplicate, encrypted, linked, unsupported, truncated and oversized ZIP evidence', () => {
  for (const bytes of [
    zip(['../escape']),
    zip(['a', 'a']),
    zip(['a'], 0, 1),
    zip(['a'], 0, 0, 0xa000),
    zip(['a'], 99),
    zip().subarray(0, -1),
    Buffer.alloc(10 * 1024 * 1024 + 1),
  ])
    expect(() => artifactFiles(bytes)).toThrow()
  const oversized = zip(['a'])
  const central = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  oversized.writeUInt32LE(2 * 1024 * 1024 + 1, central + 24)
  expect(() => artifactFiles(oversized)).toThrow()
})
