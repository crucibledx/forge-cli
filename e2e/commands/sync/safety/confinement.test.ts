import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

import {command, config, readTree} from './helpers'

const dir = useTmpDir('cli-root-link')
for (const global of [false, true])
  it.skipIf(process.platform === 'win32')(
    `BR-07 POSIX literal-backslash selected roots work through native and symlink paths, global=${global} (AC-13)`,
    async () => {
      const base = dir(),
        root = join(base, 'selected\\root'),
        link = join(base, 'root-link'),
        source = join(base, 'upstream'),
        sentinel = join(base, 'outside-sentinel')
      await mkdir(root)
      await mkdir(join(source, 'skills'), {recursive: true})
      await writeFile(join(source, 'skills/a.md'), '# A')
      await writeFile(sentinel, 'outside sentinel')
      await config(root, [{name: 'source', type: 'local', path: source}])
      await symlink(root, link)
      for (const selected of [root, link])
        for (const args of [['sync', '--dry-run'], ['sync'], ['sync']]) {
          const result = await runPipe(
            selected,
            [process.execPath, CLI_ENTRY, ...(global ? ['--global'] : []), ...args],
            {
              env: global ? {HOME: selected} : {},
            },
          )
          expect(result).toMatchObject({exitCode: 0, signal: null, timedOut: false})
          expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
          if (!args.includes('--dry-run')) expect(await readFile(join(root, '.claude/skills/a.md'), 'utf8')).toBe('# A')
        }
    },
  )

for (const global of [false, true])
  for (const name of ['team\\notes', 'anc\\estor/project'])
    it.skipIf(process.platform === 'win32')(
      `BR-07 natively created literal-backslash root ${JSON.stringify(name)} never touches its separator alias, global=${global}`,
      async () => {
        const base = dir(),
          root = join(base, name),
          alias = join(base, name.replaceAll('\\', '/')),
          source = join(base, 'up\\stream'),
          aliasSource = join(base, 'up/stream'),
          sentinel = join(base, 'outside-sentinel')
        // Bun's realpath maps literal backslashes onto separators. Create both trees outside
        // Bun so the fixture does not depend on the runtime under test.
        const created = await runPipe(base, [
          '/bin/sh',
          '-c',
          'mkdir -p "$1" "$2/.claude/skills" "$3/skills" "$4/skills" && printf "# literal" > "$3/skills/a.md" && printf "# alias" > "$4/skills/b.md" && printf "alias user bytes" > "$2/.claude/skills/a.md"',
          'native-fixture',
          root,
          alias,
          source,
          aliasSource,
        ])
        expect(created).toMatchObject({exitCode: 0, output: ''})
        await writeFile(sentinel, 'outside sentinel')
        await config(root, [{name: 'source', type: 'local', path: source}])
        await config(alias, [{name: 'source', type: 'local', path: aliasSource}])
        const aliasBefore = await readTree(alias)
        const steps = [
          {args: ['sync', '--dry-run'], plan: '(new)'},
          {args: ['sync'], plan: '(new)'},
          {args: ['sync'], plan: '(no change)'},
          {args: ['status'], plan: '(in sync)'},
        ]
        for (const {args, plan} of steps) {
          const result = await runPipe(root, [process.execPath, CLI_ENTRY, ...(global ? ['--global'] : []), ...args], {
            env: global ? {HOME: root} : {},
          })
          expect(result).toMatchObject({exitCode: 0, signal: null, timedOut: false})
          // The alias holds different bytes at the same target, so reading it would plan an update.
          expect(result.output).toContain('.claude/skills/a.md')
          expect(result.output).toContain(plan)
          for (const wrong of ['(update)', 'b.md']) expect(result.output).not.toContain(wrong)
          if (args.includes('--dry-run')) await expect(readFile(join(root, '.claude/skills/a.md'))).rejects.toThrow()
          else {
            expect(await readFile(join(root, '.claude/skills/a.md'), 'utf8')).toBe('# literal')
            await expect(readFile(join(root, '.claude/skills/b.md'))).rejects.toThrow()
            const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
            expect(Object.keys(state.files)).toEqual(['.claude/skills/a.md'])
          }
          expect(await readTree(alias)).toBe(aliasBefore)
          expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
        }
      },
    )

it('BR-07 whole CLI accepts a symlink-selected canonical root without touching a sibling sentinel (AC-13)', async () => {
  const root = dir(),
    source = join(root, 'upstream'),
    link = join(dirname(root), 'project-link'),
    sentinel = join(dirname(root), 'outside-sentinel')
  await mkdir(join(source, 'skills'), {recursive: true})
  await writeFile(join(source, 'skills/a.md'), '# A')
  await writeFile(sentinel, 'outside sentinel')
  await config(root, [{name: 'source', type: 'local', path: source}])
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect((await command(link)).exitCode).toBe(0)
  expect(await readFile(join(root, '.claude/skills/a.md'), 'utf8')).toBe('# A')
  expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
})

it.skipIf(process.platform === 'win32')(
  'BR-07 POSIX sync preserves legal Windows-reserved filenames (AC-13)',
  async () => {
    const root = dir(),
      source = join(root, 'upstream'),
      names = ['aux.md', 'com1.md', 'notes:draft.md']
    await mkdir(join(source, 'skills'), {recursive: true})
    for (const name of names) await writeFile(join(source, 'skills', name), `# ${name}`)
    await config(root, [{name: 'source', type: 'local', path: source}])
    for (const args of [['sync'], ['sync', '--dry-run'], ['sync']]) {
      expect((await command(root, args)).exitCode).toBe(0)
      for (const name of names) expect(await readFile(join(root, '.claude/skills', name), 'utf8')).toBe(`# ${name}`)
    }
  },
)
