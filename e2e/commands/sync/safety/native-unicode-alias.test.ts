import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes, syncFixture} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {command, config} from './helpers'

const dir = useTmpDir('native-unicode-alias')
it.each(['apply', 'silent', 'preview', 'silent-preview'] as const)(
  'AC-6 AC-9 AC-14 native sigma aliases refuse before target/backup/state mutation on every OS: %s',
  async (mode) => {
    const root = dir(),
      a = join(root, 'source-a'),
      b = join(root, 'source-b'),
      probe = join(root, 'probe')
    for (const folder of [join(a, 'rules'), join(b, 'rules'), probe]) await mkdir(folder, {recursive: true})
    await writeFile(join(probe, 'σ.md'), 'physical-alias probe')
    const physicalAlias = await Bun.file(join(probe, 'ς.md')).exists()
    await syncFixture(root)
    await writeFile(join(a, 'rules/σ.md'), 'source A')
    await writeFile(join(a, 'rules/neighbor.md'), 'must not install')
    await writeFile(join(b, 'rules/ς.md'), 'source B')
    await config(
      root,
      [
        {name: 'first', type: 'local', path: a},
        {name: 'last', type: 'local', path: b},
      ],
      {keep_local: true},
    )
    const before = await protectedBytes(root)
    const args = [
      'sync',
      ...(mode.includes('preview') ? ['--dry-run'] : []),
      ...(mode.includes('silent') ? ['--silent'] : []),
    ]
    for (let invocation = 0; invocation < 2; invocation++) {
      const result = await command(root, args)
      expect(result, JSON.stringify({mode, invocation, ...result})).toMatchObject({
        exitCode: 1,
        signal: null,
        timedOut: false,
      })
      expect(await protectedBytes(root)).toEqual(before)
      if (mode.includes('silent')) expect(result.stdout + result.stderr).toBe('')
    }
    console.log(
      JSON.stringify({
        probe: 'native-sigma-equivalence',
        platform: process.platform,
        physical_alias: physicalAlias,
        mode,
        rejected_before_writes: true,
      }),
    )
  },
)
it('AC-6/14 ordinary Unicode spelling and installed bytes survive conservative alias keys and repeat', async () => {
  const root = dir(),
    source = join(root, 'source'),
    filename = 'straße-東京-👩‍💻.md',
    content = 'upstream bytes'
  await mkdir(join(source, 'rules'), {recursive: true})
  await writeFile(join(source, 'rules', filename), content)
  await config(root, [{name: 'team', type: 'local', path: source}])
  const key = `.claude/rules/${filename}`
  for (let invocation = 0; invocation < 2; invocation++) {
    expect((await command(root)).exitCode).toBe(0)
    expect(await readFile(join(root, key), 'utf8')).toBe(content)
    const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
    expect(Object.keys(state.files)).toEqual([key])
    expect(state.files[key]).toMatchObject({
      baseline: 'installed',
      hash: createHash('sha256').update(content).digest('hex'),
    })
    expect(await Bun.file(join(root, key + '.bak')).exists()).toBe(false)
  }
})
