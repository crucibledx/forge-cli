/**
 * E2E tests for `forge telemetry` command output.
 *
 * Covers: default disabled state, enabled state after commands run,
 * event count visible via telemetry command, subcommand parity.
 */

import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runHealth, runSync, runTelemetry, TELEMETRY_MESSAGES as M, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-telemetry-cmd')

describe('forge telemetry (disabled)', () => {
  it('shows status header', async () => {
    const result = await runTelemetry(getDir())
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(M.status.header)
  })

  it('shows disabled by default (no config)', async () => {
    const result = await runTelemetry(getDir())
    expect(result.output).toContain(M.status.disabled)
    expect(result.output).toContain(M.status.globalDisabled)
  })

  it('shows no events when disabled', async () => {
    const result = await runTelemetry(getDir())
    expect(result.output).toContain(M.status.noEvents)
  })

  it('shows collected data description', async () => {
    const result = await runTelemetry(getDir())
    expect(result.output).toContain(M.collected.header)
    for (const item of M.collected.items) {
      expect(result.output).toContain(item)
    }
    expect(result.output).toContain(M.collected.localOnly)
    expect(result.output).toContain(M.collected.notCollected)
  })

  it('shows how to configure', async () => {
    const result = await runTelemetry(getDir())
    expect(result.output).toContain(M.howTo.toggle)
    expect(result.output).toContain(M.howTo.projectOverride)
  })
})

describe('forge telemetry (enabled, after commands)', () => {
  it('shows event count after running commands with telemetry enabled', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        telemetry: {enabled: true},
      }),
    )

    // Run a few commands to generate telemetry events
    await runHealth(dir)
    await runSync(dir)
    await runHealth(dir)

    // Now check telemetry command shows event count
    const result = await runTelemetry(dir)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(M.status.enabled)
    expect(result.output).toContain('recorded')
    expect(result.output).not.toContain(M.status.noEvents)
  })
})

describe('forge telemetry reset', () => {
  it('reports nothing to clear when no events exist', async () => {
    const result = await runTelemetry(getDir(), ['reset'])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain(M.reset.nothingToClear)
  })

  it('clears events and reports count', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        telemetry: {enabled: true},
      }),
    )

    await runHealth(dir)
    await runSync(dir)

    const reset = await runTelemetry(dir, ['reset'])
    expect(reset.exitCode).toBe(0)
    expect(reset.output).toContain('Cleared')

    // Verify events are gone via status command
    const status = await runTelemetry(dir)
    expect(status.output).toContain(M.status.noEvents)
  })
})

describe('forge telemetry status', () => {
  it('produces the same output as forge telemetry', async () => {
    const dir = getDir()
    const sub = await runTelemetry(dir, ['status'])
    expect(sub.exitCode).toBe(0)
    expect(sub.output).toContain(M.status.header)
    expect(sub.output).toContain(M.status.disabled)
  })
})
