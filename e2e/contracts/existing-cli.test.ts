import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'
import {setupLocalSync, writeConfig} from '@e2e/fixtures'
import {runPipe} from '@e2e/framework/pipe'

import pkg from '../../package.json'

const cli = resolve(import.meta.dir, '../../src/main.ts')
describe('existing agent CLI, closed stdin and separate streams (AC-21,23,29)', () => {
  const dir = useTmpDir('agent-cli')
  const command = (args: string[]) => runPipe(dir(), [process.execPath, cli, ...args])
  function outcome(result: Awaited<ReturnType<typeof runPipe>>, exit = 0) {
    expect(result.exitCode).toBe(exit)
    expect(result.signal).toBeNull()
    expect(result.timedOut).toBe(false)
    // Check raw channels, not a stripped transcript pretending to prove this.
    for (const stream of [result.stdout, result.stderr])
      expect(stream).not.toMatch(/\x1b\[[?]?(?:2004|25)[hl]|\x1b\[[0-9;]*[ABCDHJK]/)
  }
  it('help and version terminate with closed stdin and no configuration', async () => {
    const before = await snapshot(dir())
    const help = await command(['--help'])
    outcome(help)
    expect(help.stdout).toContain('Usage:')
    expect(help.stderr).toBe('')
    const version = await command(['--version'])
    outcome(version)
    expect(version.stdout.trim()).toBe(pkg.version)
    expect(version.stderr).toBe('')
    expect(await snapshot(dir())).toEqual(before)
  })
  it('preview, sync, silent, config show and previously synced status have real persisted outcomes', async () => {
    await setupLocalSync(dir(), ['claude-code'], {skills: {'agent.md': '# Agent fixture\n'}})
    const before = await snapshot(dir())
    outcome(await command(['sync', '--dry-run']))
    expect(await snapshot(dir())).toEqual(before)
    outcome(await command(['sync']))
    const path = '.claude/skills/agent.md'
    expect(await readFile(join(dir(), path), 'utf8')).toBe('# Agent fixture\n')
    const state = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
    expect(state.version).toBe(2)
    expect(state.files[path]).toMatchObject({hash: hashContent('# Agent fixture\n'), baseline: 'installed'})
    const saved = await snapshot(dir())
    for (const args of [['config', 'show'], ['status']]) {
      const result = await command(args)
      outcome(result)
      expect(result.stdout.length).toBeGreaterThan(0)
      expect(result.stderr).toBe('')
      expect(await snapshot(dir())).toEqual(saved)
    }
    for (const args of [
      ['sync', '--silent'],
      ['sync', '--dry-run', '--silent'],
    ]) {
      const result = await command(args)
      outcome(result)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
      expect(await readFile(join(dir(), path), 'utf8')).toBe('# Agent fixture\n')
    }
  })
  it.each(['missing', 'malformed', 'invalid-option'])(
    'fails %s without waiting for a prompt or changing protected data',
    async (kind) => {
      if (kind === 'malformed') await writeConfig(dir(), 'version: [invalid\n')
      const before = await snapshot(dir())
      const result = await command(kind === 'invalid-option' ? ['sync', '--not-a-forge-option'] : ['sync'])
      outcome(result, 1)
      expect(result.stdout + result.stderr).not.toContain('Select assistants')
      expect(await snapshot(dir())).toEqual(before)
      expect(existsSync(join(dir(), '.crucible/sync-state.json'))).toBe(false)
    },
  )
})
