import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {command, config} from './helpers'

const dir = useTmpDir('source-removal')
it.each([false, true])(
  'BR-03 removes one source while another remains; empty keep_local=%s retains/deletes tracked files (AC-3)',
  async (keep_local) => {
    const root = dir(),
      a = join(root, 'a'),
      b = join(root, 'b')
    for (const [source, name] of [
      [a, 'a'],
      [b, 'b'],
    ]) {
      await mkdir(join(source, 'skills'), {recursive: true})
      await writeFile(join(source, `skills/${name}.md`), `# ${name}`)
    }
    await config(root, [
      {name: 'a', type: 'local', path: a},
      {name: 'b', type: 'local', path: b},
    ])
    expect((await command(root)).exitCode).toBe(0)
    await config(root, [{name: 'b', type: 'local', path: b}])
    expect((await command(root)).exitCode).toBe(0)
    expect(existsSync(join(root, '.claude/skills/a.md'))).toBe(false)
    expect(await readFile(join(root, '.claude/skills/b.md'), 'utf8')).toBe('# b')
    const empty = join(root, 'empty')
    await mkdir(empty)
    await config(root, [{name: 'empty', type: 'local', path: empty}], {keep_local})
    expect((await command(root)).exitCode).toBe(0)
    expect(existsSync(join(root, '.claude/skills/b.md'))).toBe(keep_local)
    const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
    expect(Boolean(state.files['.claude/skills/b.md'])).toBe(keep_local)
  },
)
