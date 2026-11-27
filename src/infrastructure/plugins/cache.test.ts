import {chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {listCacheFiles} from './cache'
import {PluginCacheError} from './errors'

const dir = useTmpDir('plugin-cache')

describe('listCacheFiles', () => {
  it('treats a missing cache root as empty', async () => {
    await expect(listCacheFiles(join(dir(), 'missing'))).resolves.toEqual([])
  })

  it('lists the forge-managed files: plugin versions, catalogs and the cache .gitignore', async () => {
    const root = join(dir(), 'cache')
    await mkdir(join(root, 'hello/1.0.0/droid'), {recursive: true})
    await mkdir(join(root, '.factory-plugin'), {recursive: true})
    await writeFile(join(root, '.gitignore'), '*\n')
    await writeFile(join(root, '.factory-plugin/marketplace.json'), '{}')
    await writeFile(join(root, 'hello/1.0.0/droid/x.md'), 'x')
    await writeFile(join(root, 'stray.txt'), 'not managed')

    const files = await listCacheFiles(root)
    expect(files).toContain('.gitignore')
    expect(files).toContain('.factory-plugin/marketplace.json')
    expect(files).toContain('hello/1.0.0/droid/x.md')
    expect(files).not.toContain('stray.txt')
  })

  it.skipIf(process.platform === 'win32')(
    'aborts with a named cache error when a directory is unreadable',
    async () => {
      const root = join(dir(), 'blocked')
      await mkdir(join(root, 'hello/1.0.0'), {recursive: true})
      await chmod(join(root, 'hello'), 0o000)
      try {
        await expect(listCacheFiles(root)).rejects.toBeInstanceOf(PluginCacheError)
      } finally {
        await chmod(join(root, 'hello'), 0o755)
      }
    },
  )
})
