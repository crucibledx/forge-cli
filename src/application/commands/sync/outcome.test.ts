import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, beforeEach, describe, expect, it, spyOn} from 'bun:test'
import {parse as parseYaml} from 'yaml'

import type {SyncReport} from '@domain/sync/report'
import {transactionIO} from '@infrastructure/fs/transaction'

import {runSyncWithDependencies} from './handler'

describe('BR-04–08 truthful outcomes and incidental storage (AC-7,8,15,23)', () => {
  const dir = useTmpDir('outcome')
  beforeEach(() => {
    process.exitCode = 0
  })
  afterEach(() => {
    process.exitCode = 0
  })
  const options = {dryRun: false, verbose: false, silent: true}
  async function dependencies() {
    const {context} = await syncFixture(dir())
    const written: SyncReport[] = []
    return {
      written,
      io: {resolveProjectRoot: dir, buildContext: async () => context},
      loadSource: async () => [{relativePath: 'rules/a.md', content: 'after'}],
      reports: {
        writeReport: async (report: SyncReport) => {
          written.push(report)
        },
        rotate: async () => {},
        readLatest: async () => null,
        readHistory: async () => [],
        getReportDir: () => dir(),
      },
    }
  }
  for (const keep of [false, true])
    for (const preview of [false, true])
      it(`AC-3,7,8 empty acquisition reaches real orchestration: keep=${keep}, preview=${preview}`, async () => {
        const deps = await dependencies()
        const context = await deps.io.buildContext()
        context.projectConfig.sync = {...context.projectConfig.sync!, keep_local: keep}
        deps.loadSource = async () => []
        const before = await snapshot(dir())
        await runSyncWithDependencies({...options, dryRun: preview}, deps)
        expect(process.exitCode).toBe(0)
        if (preview) {
          expect(await snapshot(dir())).toEqual(before)
          expect(deps.written).toEqual([])
        } else {
          expect(existsSync(join(dir(), trackedPath))).toBe(keep)
          const state = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
          const config = parseYaml(await readFile(join(dir(), '.crucible/forge.config.yaml'), 'utf8'))
          expect(Boolean(state.files[trackedPath])).toBe(keep)
          expect(state.lastSync).toBe(config.lastSync)
          expect(state.lastSync).not.toBe(context.projectConfig.lastSync)
          expect(deps.written[0].success).toBe(true)
        }
      })
  for (const strategy of ['local-wins', 'remote-wins', 'error'] as const)
    for (const preview of [false, true])
      for (const equal of [false, true])
        it(`AC-6 legacy Windows keys migrate conservatively: ${strategy}, preview=${preview}, equal=${equal}`, async () => {
          const deps = await dependencies(),
            context = await deps.io.buildContext()
          context.projectConfig.sync = {...context.projectConfig.sync!, local_conflict_strategy: strategy}
          const raw = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
          raw.files[trackedPath.replaceAll('/', '\\')] = raw.files[trackedPath]
          delete raw.files[trackedPath]
          await writeFile(join(dir(), '.crucible/sync-state.json'), JSON.stringify(raw))
          if (equal) await writeFile(join(dir(), trackedPath), 'after')
          const before = await snapshot(dir()),
            failed = strategy === 'error' && !equal
          await runSyncWithDependencies({...options, dryRun: preview}, deps)
          expect(process.exitCode).toBe(failed ? 1 : 0)
          if (preview || failed) expect(await snapshot(dir())).toEqual(before)
          else {
            const next = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
            expect(Object.keys(next.files)).toEqual([trackedPath])
            expect(next.files[trackedPath].baseline).toBe(
              !equal && strategy === 'local-wins' ? 'legacy-unknown' : 'installed',
            )
            expect(await readFile(join(dir(), trackedPath), 'utf8')).toBe(
              !equal && strategy === 'local-wins' ? 'before' : 'after',
            )
          }
        })
  it('AC-2,15 reports every distinct source failure cause, successful acquisitions and exact error count', async () => {
    const deps = await dependencies(),
      context = await deps.io.buildContext()
    context.projectConfig.sources = ['alpha', 'beta', 'gamma', 'empty'].map((name) => ({
      name,
      type: 'local',
      path: 'unused',
    }))
    deps.loadSource = async (source?: {name: string}) => {
      if (source?.name === 'alpha') throw new Error('alpha-read-denied')
      if (source?.name === 'beta') throw new Error('beta-branch-unavailable')
      return source?.name === 'empty' ? [] : [{relativePath: 'rules/a.md', content: 'after'}]
    }
    const out = spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runSyncWithDependencies({...options, silent: false}, deps)
      const text = out.mock.calls.flat().join('\n')
      expect(text).toContain('Failed to fetch source "alpha": alpha-read-denied')
      expect(text).toContain('Failed to fetch source "beta": beta-branch-unavailable')
      expect(text).toContain('Acquired "gamma": 1 resolved targets (not yet installed)')
      expect(text).toContain('Acquired "empty": 0 resolved targets (not yet installed)')
      expect(text).toContain('dry-run')
      expect(deps.written[0].files.errors).toBe(2)
      expect(deps.written[0].files.synced).toBe(0)
      expect(deps.written[0].success).toBe(false)
    } finally {
      out.mockRestore()
    }
  })
  it('commits identical state/config timestamps even for a successful no-op and keeps repeat bytes stable', async () => {
    const deps = await dependencies()
    await runSyncWithDependencies(options, deps)
    expect(process.exitCode).toBe(0)
    const beforeTarget = await readFile(join(dir(), trackedPath))
    const beforeBackup = await readFile(join(dir(), `${trackedPath}.bak`))
    await runSyncWithDependencies(options, deps)
    expect(process.exitCode).toBe(0)
    expect(await readFile(join(dir(), trackedPath))).toEqual(beforeTarget)
    expect(await readFile(join(dir(), `${trackedPath}.bak`))).toEqual(beforeBackup)
    const state = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
    const config = parseYaml(await readFile(join(dir(), '.crucible/forge.config.yaml'), 'utf8'))
    expect(state.version).toBe(2)
    expect(state.lastSync).toBe(config.lastSync)
    expect(state.files[trackedPath].baseline).toBe('installed')
    expect(deps.written.map((report) => report.success)).toEqual([true, true])
  })
  it.each([false, true])('never writes reports/protected data for dry-run, including failed=%s', async (failed) => {
    const deps = await dependencies()
    const before = await snapshot(dir())
    if (failed)
      deps.loadSource = async () => {
        throw new Error('failed preview')
      }
    await runSyncWithDependencies({...options, dryRun: true}, deps)
    expect(process.exitCode).toBe(failed ? 1 : 0)
    expect(await snapshot(dir())).toEqual(before)
    expect(deps.written).toEqual([])
  })
  it('records a redacted failed latest outcome rather than a previous success', async () => {
    const deps = await dependencies()
    const before = await snapshot(dir())
    deps.loadSource = async () => {
      throw new Error('nested cause: https://user:credential-sentinel@host/repo?token=query-sentinel')
    }
    await runSyncWithDependencies(options, deps)
    expect(process.exitCode).toBe(1)
    expect(await snapshot(dir())).toEqual(before)
    expect(deps.written[0].success).toBe(false)
    expect(deps.written[0].files.synced).toBe(0)
    expect(deps.written[0].files.errors).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(deps.written)).not.toContain('credential-sentinel')
    expect(JSON.stringify(deps.written)).not.toContain('query-sentinel')
  })
  it('report storage failure cannot reverse a committed outcome', async () => {
    const deps = await dependencies()
    deps.reports.writeReport = async () => {
      throw new Error('report storage denied')
    }
    await runSyncWithDependencies(options, deps)
    expect(process.exitCode).toBe(0)
    expect(await readFile(join(dir(), trackedPath), 'utf8')).toBe('after')
  })
  it('always emits redacted recovery-required stderr despite silent mode and broken report storage', async () => {
    const deps = await dependencies()
    deps.reports.writeReport = async () => {
      throw new Error('report storage denied')
    }
    let restoring = false
    const transaction = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        if (args[1].endsWith('forge.config.yaml') && !restoring) {
          restoring = true
          throw new Error('config commit failed https://user:credential-sentinel@host')
        }
        if (args[1].endsWith('sync-state.json') && restoring) throw new Error('state restoration failed')
        await transactionIO.replace(...args)
      },
    }
    const stderr = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await runSyncWithDependencies(options, {...deps, transaction})
      expect(process.exitCode).toBe(1)
      const message = stderr.mock.calls.flat().join(' ')
      expect(message).toContain('Recovery required')
      expect(message).toContain('.crucible/sync-state.json')
      expect(message).not.toContain('credential-sentinel')
      expect(message).not.toContain('after')
    } finally {
      stderr.mockRestore()
    }
  })
})
