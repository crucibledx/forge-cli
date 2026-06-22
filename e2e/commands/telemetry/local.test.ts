/**
 * E2E tests for local telemetry backend (JSONL storage).
 *
 * Covers: events written to disk, event structure, file_count on sync,
 * duration_ms populated, no events when disabled, success:false on failure,
 * uninstall edge case (telemetry dir deleted, postAction still safe).
 */

import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import type {TelemetryEvent} from '@infrastructure/telemetry/types'
import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {
  crucibleDirPath,
  runHealth,
  runSync,
  runUninstallSession,
  TIMEOUT_MS,
  UNINSTALL_MESSAGES,
  useTmpDir,
  Y,
} from '@e2e/framework'

const getDir = useTmpDir('forge-telemetry-local')

const TELEMETRY_DIR_RELATIVE = join('.crucible', 'forge', 'telemetry')

function readTelemetryEvents(homeDir: string): TelemetryEvent[] {
  const telDir = join(homeDir, TELEMETRY_DIR_RELATIVE)
  if (!existsSync(telDir)) return []

  const files = readdirSync(telDir)
    .filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'))
    .sort()

  const events: TelemetryEvent[] = []
  for (const file of files) {
    const content = readFileSync(join(telDir, file), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      events.push(JSON.parse(line) as TelemetryEvent)
    }
  }
  return events
}

describe('local telemetry backend', () => {
  it('does not write events when telemetry is disabled', async () => {
    const dir = getDir()
    await writeConfig(dir, buildConfigYaml({assistants: []}))

    await runHealth(dir)

    const events = readTelemetryEvents(dir)
    expect(events).toHaveLength(0)
  })

  it('writes events to JSONL files when telemetry is enabled', async () => {
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

    const events = readTelemetryEvents(dir)
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it('records correct event structure', async () => {
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

    const events = readTelemetryEvents(dir)
    const event = events.find((e) => e.event === 'health')
    expect(event).toBeDefined()
    expect(event!.ts).toBeDefined()
    expect(event!.forge_version).toBeDefined()
    expect(event!.os).toBeDefined()
    expect(event!.duration_ms).toBeGreaterThanOrEqual(0)
    expect(event!.success).toBe(true)
  })

  it('records duration_ms > 0 for real commands', async () => {
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

    await runSync(dir)

    const events = readTelemetryEvents(dir)
    const syncEvent = events.find((e) => e.event === 'sync')
    expect(syncEvent).toBeDefined()
    expect(syncEvent!.duration_ms).toBeGreaterThan(0)
  })

  it('records file_count on sync command', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'review.md': '# Review'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        telemetry: {enabled: true},
      }),
    )

    await runSync(dir)

    const events = readTelemetryEvents(dir)
    const syncEvent = events.find((e) => e.event === 'sync')
    expect(syncEvent).toBeDefined()
    expect(syncEvent!.file_count).toBeDefined()
    expect(syncEvent!.file_count).toBeGreaterThan(0)
  })

  it('does not include file_count on non-sync commands', async () => {
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

    const events = readTelemetryEvents(dir)
    const healthEvent = events.find((e) => e.event === 'health')
    expect(healthEvent).toBeDefined()
    expect(healthEvent!.file_count).toBeUndefined()
  })

  it('accumulates events across multiple commands', async () => {
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
    await runHealth(dir)

    const events = readTelemetryEvents(dir)
    expect(events.length).toBeGreaterThanOrEqual(3)

    const eventNames = events.map((e) => e.event)
    expect(eventNames).toContain('health')
    expect(eventNames).toContain('sync')
  })

  it('records success: false when a command fails', async () => {
    const dir = getDir()
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: [],
        telemetry: {enabled: true},
      }),
    )

    // sync without sources will fail with CommandError
    const result = await runSync(dir)
    expect(result.exitCode).toBe(1)

    const events = readTelemetryEvents(dir)
    const syncEvent = events.find((e) => e.event === 'sync')
    expect(syncEvent).toBeDefined()
    expect(syncEvent!.success).toBe(false)
  })

  it(
    'uninstall does not crash when telemetry dir is deleted',
    async () => {
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

      // Generate some telemetry events first
      await runHealth(dir)
      const eventsBefore = readTelemetryEvents(dir)
      expect(eventsBefore.length).toBeGreaterThan(0)

      // Uninstall removes .crucible/ (which contains telemetry dir under HOME)
      await runUninstallSession(dir, (cli) =>
        cli.waitForText('Continue?').pressKey(Y).waitForText(UNINSTALL_MESSAGES.done),
      )

      // .crucible dir should be gone
      expect(existsSync(crucibleDirPath(dir))).toBe(false)

      // No telemetry events remain
      const eventsAfter = readTelemetryEvents(dir)
      expect(eventsAfter).toHaveLength(0)
    },
    TIMEOUT_MS,
  )
})
