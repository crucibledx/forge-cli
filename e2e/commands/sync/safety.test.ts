import {existsSync} from 'node:fs'
import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'
import {stringify} from 'yaml'

import {getAllAssistants} from '@domain/assistants'
import {hashContent} from '@domain/sync/state'
import {buildConfigYaml, SKILL_DEPLOY, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {createBareRepo} from '@e2e/framework/git'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../scripts/test-sandbox'

const cli = resolve(import.meta.dir, '../../..', 'src/main.ts')
const tracked = '.claude/skills/deploy.md'
describe('BR-01–08 CLI safety snapshots (AC-2–15,23)', () => {
  const dir = useTmpDir('sync-safety')
  const sync = (flags: string[] = []) =>
    runPipe(dir(), [
      process.execPath,
      cli,
      ...flags.filter((flag) => flag === '--global'),
      'sync',
      ...flags.filter((flag) => flag !== '--global'),
    ])
  async function seed() {
    await mkdir(join(dir(), '.claude/skills'), {recursive: true})
    await writeFile(join(dir(), tracked), 'installed')
    await writeFile(join(dir(), '.claude/skills/untracked.md'), 'untracked sentinel')
    await mkdir(join(dir(), '.crucible'), {recursive: true})
    await writeFile(
      join(dir(), '.crucible/sync-state.json'),
      JSON.stringify(
        {
          version: 2,
          lastSync: '2026-01-01T00:00:00.000Z',
          files: {[tracked]: {hash: hashContent('installed'), sourceName: 'removed-source', baseline: 'installed'}},
        },
        null,
        2,
      ),
    )
  }
  async function latest() {
    return JSON.parse(await readFile(join(testEnvironment(dir()).HOME, '.crucible/forge/reports/latest.json'), 'utf8'))
  }
  it.each(['local-missing', 'local-file', 'git-clone', 'git-branch', 'git-subdir-missing', 'git-subdir-file'])(
    'aborts %s plus a valid neighbor without target/backup/metadata mutation',
    async (failure) => {
      await seed()
      const good = join(dir(), 'good')
      await writeSourceTree(good, {skills: {'new.md': 'valid neighbor'}})
      const repo = failure.startsWith('git-') ? await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY}) : ''
      const file = join(dir(), 'not-a-directory')
      await writeFile(file, 'not a directory')
      const bad = failure.startsWith('local')
        ? {name: 'failed', type: 'local', path: failure === 'local-file' ? file : join(dir(), 'missing')}
        : {
            name: 'failed',
            type: 'git',
            url: failure === 'git-clone' ? join(dir(), 'no-repo.git') : repo,
            branch: failure === 'git-branch' ? 'missing-branch' : 'main',
            ...(failure === 'git-subdir-missing'
              ? {path: 'missing'}
              : failure === 'git-subdir-file'
                ? {path: 'skills/deploy.md'}
                : {}),
          }
      await writeConfig(
        dir(),
        stringify({
          version: '1',
          assistants: [{id: 'claude-code', enabled: true}],
          sources: [bad, {name: 'valid-neighbor', type: 'local', path: good}],
          sync: {keep_local: false},
        }),
      )
      const before = await snapshot(dir())
      const result = await sync()
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('failed')
      expect(result.stdout).toContain('valid-neighbor')
      expect(result.stdout).toContain('not yet installed')
      expect(await snapshot(dir())).toEqual(before)
      expect((await latest()).success).toBe(false)
      expect((await latest()).files.synced).toBe(0)
      expect((await latest()).files.errors).toBeGreaterThanOrEqual(1)
    },
  )
  it.each(['empty', 'filtered-local', 'filtered-git'])(
    'uses successful %s input for tracked cleanup, not an unconditional early return',
    async (kind) => {
      await seed()
      const source = join(dir(), 'source')
      await mkdir(source)
      const repo = kind === 'filtered-git' ? await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY}) : undefined
      if (kind === 'filtered-local') await writeSourceTree(source, {skills: {'ignored.md': 'ignored'}})
      await writeConfig(
        dir(),
        stringify({
          version: '1',
          assistants: [{id: 'claude-code', enabled: true}],
          sources: [
            repo
              ? {name: 'readable', type: 'git', url: repo, branch: 'main', exclude: ['**']}
              : {
                  name: 'readable',
                  type: 'local',
                  path: source,
                  ...(kind === 'filtered-local' ? {exclude: ['**']} : {}),
                },
          ],
          sync: {keep_local: false},
        }),
      )
      const result = await sync()
      if (process.platform === 'win32') {
        expect(result.exitCode).toBe(1)
        expect(result.stdout).toContain('Deletion refused')
        return
      }
      expect(result.exitCode).toBe(0)
      expect(existsSync(join(dir(), tracked))).toBe(false)
      expect(await readFile(join(dir(), '.claude/skills/untracked.md'), 'utf8')).toBe('untracked sentinel')
      expect(JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8')).files).toEqual({})
    },
  )
  it('rejects final-source removal without cleaning anything', async () => {
    await seed()
    await writeConfig(dir(), buildConfigYaml({assistants: ['claude-code'], sync: {keep_local: false}}))
    const before = await snapshot(dir())
    expect((await sync()).exitCode).toBe(1)
    expect(await snapshot(dir())).toEqual(before)
  })
  it.each([false, true])('dry-run leaves reports and all protected bytes unchanged, empty=%s', async (empty) => {
    await seed()
    const source = join(dir(), 'source')
    await mkdir(source)
    if (!empty) await writeSourceTree(source, {skills: {'deploy.md': 'changed'}})
    await writeConfig(
      dir(),
      buildConfigYaml({assistants: ['claude-code'], localSource: {path: source}, sync: {keep_local: false}}),
    )
    const before = await snapshot(dir())
    expect((await sync(['--dry-run'])).exitCode).toBe(0)
    expect(await snapshot(dir())).toEqual(before)
    expect(existsSync(join(testEnvironment(dir()).HOME, '.crucible/forge/reports'))).toBe(false)
  })
  it.each([false, true])(
    'confines project/global target symlinks and preserves the external sentinel, global=%s',
    async (global) => {
      const root = global ? testEnvironment(dir()).HOME : dir()
      const outside = join(dirname(dir()), 'outside')
      await mkdir(join(outside, 'skills'), {recursive: true})
      await writeFile(join(outside, 'skills/deploy.md'), 'external sentinel')
      await symlink(outside, join(root, '.claude'), process.platform === 'win32' ? 'junction' : 'dir')
      const source = join(dir(), 'source')
      await writeSourceTree(source, {skills: {'deploy.md': 'incoming'}})
      await writeConfig(root, buildConfigYaml({assistants: ['claude-code'], localSource: {path: source}}))
      const before = await readFile(join(root, '.crucible/forge.config.yaml'))
      const result = await sync(global ? ['--global'] : [])
      expect(result.exitCode).toBe(1)
      expect(await readFile(join(outside, 'skills/deploy.md'), 'utf8')).toBe('external sentinel')
      expect(await readFile(join(root, '.crucible/forge.config.yaml'))).toEqual(before)
      expect(existsSync(join(root, '.crucible/sync-state.json'))).toBe(false)
    },
  )
  it('writes only enabled assistants and retains disabled/unknown entries and bytes', async () => {
    await seed()
    const source = join(dir(), 'source')
    await writeSourceTree(source, {skills: {'deploy.md': 'desired'}})
    await writeConfig(
      dir(),
      stringify({
        version: '1',
        assistants: getAllAssistants().map((assistant) => ({id: assistant.id, enabled: assistant.id === 'cursor'})),
        sources: [{name: 'team', type: 'local', path: source}],
        sync: {keep_local: false},
      }),
    )
    expect((await sync()).exitCode).toBe(0)
    expect(await readFile(join(dir(), tracked), 'utf8')).toBe('installed')
    expect(await readFile(join(dir(), '.cursor/skills/deploy.md'), 'utf8')).toBe('desired')
    const state = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
    expect(state.files[tracked].hash).toBe(hashContent('installed'))
    expect(state.files['.cursor/skills/deploy.md'].hash).toBe(hashContent('desired'))
  })
  it('backs up exact non-UTF8 bytes rather than decoded replacement characters', async () => {
    const source = join(dir(), 'source')
    await writeSourceTree(source, {skills: {'deploy.md': '\uFFFD'}})
    await writeConfig(dir(), buildConfigYaml({assistants: ['claude-code'], localSource: {path: source}}))
    await mkdir(join(dir(), '.claude/skills'), {recursive: true})
    await writeFile(join(dir(), tracked), Buffer.from([0xff]))
    expect((await sync()).exitCode).toBe(0)
    expect(await readFile(join(dir(), `${tracked}.bak`))).toEqual(Buffer.from([0xff]))
    expect(await readFile(join(dir(), tracked))).toEqual(Buffer.from('\uFFFD'))
  })
  it('silent mode suppresses normal failure presentation but keeps failure exit and report', async () => {
    await writeConfig(
      dir(),
      buildConfigYaml({assistants: ['claude-code'], localSource: {path: join(dir(), 'missing')}}),
    )
    const before = await snapshot(dir())
    const result = await sync(['--silent'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
    expect(await snapshot(dir())).toEqual(before)
    expect((await latest()).success).toBe(false)
  })
})
