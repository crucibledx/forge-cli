import {chmod, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import type {FileOperation, TransactionIO} from './transaction'
import {prepareTransaction, TransactionError, transactionIO} from './transaction'

/** Fail once, optionally after the operation already changed disk. No production fault flags. */
export function fault(method: keyof TransactionIO, nth: number, after = false): TransactionIO {
  let calls = 0
  return new Proxy(transactionIO, {
    get(target, key) {
      const original = Reflect.get(target, key)
      if (key !== method) return original
      return async (...args: unknown[]) => {
        const fail = ++calls === nth
        if (fail && !after) throw new Error(`Injected ${String(key)} boundary ${nth}`)
        const result = await Reflect.apply(original, target, args)
        if (fail) throw new Error(`Injected partial ${String(key)} boundary ${nth}`)
        return result
      }
    },
  })
}

describe('BR-06 compensated transaction (AC-10)', () => {
  const dir = useTmpDir('transaction')
  const operations: FileOperation[] = [
    {path: 'a.md.bak', content: 'before', backup: true},
    {path: 'a.md', content: 'after'},
    {path: 'new/nested/b.md', content: 'new'},
    {path: 'old.md', content: null},
    {path: '.crucible/sync-state.json', content: '{"version":2}', private: true},
    {path: '.crucible/forge.config.yaml', content: 'lastSync: new\n', private: true},
  ]
  async function fixture() {
    await mkdir(join(dir(), '.crucible'))
    for (const [path, content] of Object.entries({
      'a.md': 'before',
      'old.md': 'stale',
      '.crucible/sync-state.json': '{ "legacy": true }\n',
      '.crucible/forge.config.yaml': '# original\nlastSync: old\n',
    })) {
      await writeFile(join(dir(), path), content)
      await chmod(join(dir(), path), 0o640)
    }
    return snapshot(dir())
  }
  const replacements = [1, 2, 3, 4, 5].flatMap((nth) =>
    [false, true].map((after) => ({method: 'replace' as const, nth, after})),
  )
  const boundaries = [
    ...replacements,
    ...(['writeTemp', 'chmod'] as const).flatMap((method) =>
      [1, 2, 3, 4, 5].flatMap((nth) => [false, true].map((after) => ({method, nth, after}))),
    ),
    ...(['mkdir', 'unlink'] as const).flatMap((method) => [false, true].map((after) => ({method, nth: 1, after}))),
    ...(['lstat', 'readFile'] as const).map((method) => ({method, nth: 1, after: false})),
  ]
  it.each(boundaries)(
    'restores bytes/modes/existence/directories at $method $nth after=$after',
    async ({method, nth, after}) => {
      const before = await fixture()
      await expect(
        (async () => (await prepareTransaction(dir(), operations, fault(method, nth, after))).commit())(),
      ).rejects.toThrow()
      expect(await snapshot(dir())).toEqual(before)
    },
  )
  it('compensates a temporary file that throws after only a prefix was written', async () => {
    const before = await fixture()
    let failed = false
    const fs = {
      ...transactionIO,
      writeTemp: async (path: string, bytes: Uint8Array) => {
        if (!failed) {
          failed = true
          await writeFile(path, bytes.subarray(0, 2), {flag: 'wx', mode: 0o600})
          throw new Error('partial temporary write')
        }
        await transactionIO.writeTemp(path, bytes)
      },
    }
    await expect((async () => (await prepareTransaction(dir(), operations, fs)).commit())()).rejects.toThrow()
    expect(await snapshot(dir())).toEqual(before)
  })
  it('prepare/dry-run is read-only and commit preserves existing/new permission policy', async () => {
    const before = await fixture()
    const prepared = await prepareTransaction(dir(), operations)
    expect(await snapshot(dir())).toEqual(before)
    await prepared.commit()
    expect(await readFile(join(dir(), 'a.md'), 'utf8')).toBe('after')
    expect(await readFile(join(dir(), 'a.md.bak'), 'utf8')).toBe('before')
    const after = await snapshot(dir())
    if (process.platform !== 'win32') {
      expect(after['a.md'].mode).toBe(0o640)
      expect(after['new/nested/b.md'].mode).toBe(0o666 & ~process.umask())
    }
    expect(Object.keys(after).some((path) => path.endsWith('.tmp'))).toBe(false)
  })
  it('new metadata is private, and originally absent metadata disappears on compensation', async () => {
    const ops: FileOperation[] = [
      {path: '.crucible/state.json', content: '{}', private: true},
      {path: '.crucible/config.yaml', content: '{}', private: true},
    ]
    await expect(
      (async () => (await prepareTransaction(dir(), ops, fault('replace', 2, true))).commit())(),
    ).rejects.toThrow('Rollback complete')
    expect(await readdir(dir())).toEqual([])
    await (await prepareTransaction(dir(), ops)).commit()
    if (process.platform !== 'win32') expect((await snapshot(dir()))['.crucible/state.json'].mode).toBe(0o600)
  })
  it('returns the exact unrestored paths if directory removal also fails', async () => {
    let count = 0
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<TransactionIO['replace']>) => {
        if (++count === 1) throw new Error('primary replace failure')
        await transactionIO.replace(...args)
      },
      rmdir: async () => {
        throw new Error('cleanup denied')
      },
    }
    try {
      await (await prepareTransaction(dir(), [{path: 'new/a.md', content: 'new'}], fs)).commit()
      throw new Error('expected transaction failure')
    } catch (error) {
      expect(error).toBeInstanceOf(TransactionError)
      expect((error as TransactionError).unrestored).toEqual(['new'])
      expect((error as Error).message).toContain('primary replace failure')
      expect((error as Error).message).not.toContain('Rollback complete')
    }
  })
})
