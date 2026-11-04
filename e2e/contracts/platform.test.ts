import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {buildConfigYaml, setupLocalSync, writeConfig} from '@e2e/fixtures'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../scripts/test-sandbox'

const dir = useTmpDir('native-platform')
const cli = resolve(import.meta.dir, '../../src/main.ts')
const destinations = [
  {id: 'claude-code', project: '.claude/rules/native.md', global: '.claude/rules/native.md'},
  {id: 'cursor', project: '.cursor/rules/native.mdc', global: '.cursor/rules/native.mdc'},
  {id: 'windsurf', project: '.windsurf/rules/native.md', global: '.codeium/windsurf/rules/native.md'},
  {
    id: 'copilot',
    project: '.github/instructions/native.instructions.md',
    global: '.github/instructions/native.instructions.md',
  },
  {id: 'cline', project: '.clinerules/native.md', global: 'Documents/Cline/Rules/native.md'},
]
it.each(destinations.flatMap((assistant) => [false, true].map((global) => ({...assistant, globalMode: global}))))(
  'native $id persisted ownership and cleanup, global=$globalMode (AC-4,26)',
  async (assistant) => {
    const root = assistant.globalMode ? testEnvironment(dir()).HOME : dir()
    const source = await setupLocalSync(dir(), [assistant.id], {rules: {'native.md': '# Native fixture\n'}})
    if (assistant.globalMode)
      await writeConfig(
        root,
        buildConfigYaml({assistants: [assistant.id], localSource: {path: source}, sync: {keep_local: false}}),
      )
    else
      await writeConfig(
        root,
        buildConfigYaml({assistants: [assistant.id], localSource: {path: source}, sync: {keep_local: false}}),
      )
    const args = [process.execPath, cli, ...(assistant.globalMode ? ['--global'] : []), 'sync']
    const path = assistant.globalMode ? assistant.global : assistant.project
    expect((await runPipe(dir(), args)).exitCode).toBe(0)
    const before = await readFile(join(root, path))
    expect(before.toString()).toContain('# Native fixture')
    const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
    expect(state.files[path].baseline).toBe('installed')
    // Disabled ownership must retain persisted bytes and entry under cleanup.
    await writeConfig(
      root,
      `version: "1"\nassistants:\n  - id: ${assistant.id}\n    enabled: false\n  - id: ${assistant.id === 'cline' ? 'cursor' : 'cline'}\n    enabled: true\nsources:\n  - name: local\n    type: local\n    path: ${JSON.stringify(source)}\nsync:\n  keep_local: false\n`,
    )
    expect((await runPipe(dir(), args)).exitCode).toBe(0)
    expect(await readFile(join(root, path))).toEqual(before)
    expect(JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).files[path]).toEqual(
      state.files[path],
    )
    await unlink(join(source, 'rules/native.md'))
    await writeConfig(
      root,
      buildConfigYaml({assistants: [assistant.id], localSource: {path: source}, sync: {keep_local: false}}),
    )
    // This intentionally fails on builds that refuse Windows deletion: safe refusal
    // is a known limitation, not a passing native-cleanup acceptance result.
    expect((await runPipe(dir(), args)).exitCode).toBe(0)
    expect(existsSync(join(root, path))).toBe(false)
  },
)
it('native access metadata remains supported or read-only replacement refuses safely (AC-10,26)', async () => {
  await setupLocalSync(dir(), ['claude-code'], {rules: {'native.md': '# Native fixture\n'}})
  const args = [process.execPath, cli, 'sync']
  expect((await runPipe(dir(), args)).exitCode).toBe(0)
  const path = join(dir(), '.claude/rules/native.md')
  await writeFile(join(dir(), 'source/rules/native.md'), '# Changed native fixture\n')
  await chmod(path, 0o400)
  await mkdir(join(dir(), 'unrelated'), {recursive: true})
  if (process.platform === 'win32') {
    const result = await runPipe(dir(), args)
    expect(result.exitCode).toBe(1)
    expect(await readFile(path, 'utf8')).toBe('# Native fixture\n')
  } else {
    expect((await runPipe(dir(), args)).exitCode).toBe(0)
    expect(await readFile(path, 'utf8')).toBe('# Changed native fixture\n')
    expect((await Bun.file(path).stat()).mode & 0o777).toBe(0o400)
  }
  await chmod(path, 0o600)
})
