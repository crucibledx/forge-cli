import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-force')

describe('forge sync --force (0003 §6)', () => {
  it('overwrites drift over local_conflict_strategy error and lists what it overrode', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Original'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {local_conflict_strategy: 'error', backup: false},
      }),
    )
    expect((await runSync(dir)).exitCode).toBe(0)
    const target = join(dir, '.claude/skills/deploy.md')
    await writeFile(target, '# User Modified')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Remote Updated'}})

    expect((await runSync(dir)).exitCode).toBe(1)
    expect(await readFile(target, 'utf-8')).toBe('# User Modified')

    const preview = await runSync(dir, ['--force', '--dry-run'])
    expect(preview.exitCode).toBe(0)
    expect(preview.stdout + preview.stderr).toContain('--force overwrites drift: .claude/skills/deploy.md')
    expect(await readFile(target, 'utf-8')).toBe('# User Modified')

    expect((await runSync(dir, ['--force'])).exitCode).toBe(0)
    expect(await readFile(target, 'utf-8')).toBe('# Remote Updated')
  })
})
