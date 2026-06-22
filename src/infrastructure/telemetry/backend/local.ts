import {existsSync, mkdirSync, readdirSync} from 'node:fs'
import {appendFile, readFile, rm} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {TelemetryEvent} from '../types'
import {backendsRegistry} from './registry'
import type {TelemetryBackend} from './types'
import {TELEMETRY_BACKEND_TYPES} from './types'

const TELEMETRY_DIR = join(homedir(), '.crucible', 'forge', 'telemetry')

function ensureDir(): void {
  if (!existsSync(TELEMETRY_DIR)) {
    mkdirSync(TELEMETRY_DIR, {recursive: true})
  }
}

function eventsFilename(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `events-${date}.jsonl`
}

function listEventFiles(): string[] {
  if (!existsSync(TELEMETRY_DIR)) return []
  return readdirSync(TELEMETRY_DIR)
    .filter((f) => f.startsWith('events-') && f.endsWith('.jsonl'))
    .sort()
}

export function createLocalBackend(): TelemetryBackend {
  return {
    storageDir: TELEMETRY_DIR,

    async write(event: TelemetryEvent): Promise<void> {
      ensureDir()
      const line = JSON.stringify(event) + '\n'
      await appendFile(join(TELEMETRY_DIR, eventsFilename()), line, 'utf-8')
    },

    async readAll(limit = 200): Promise<TelemetryEvent[]> {
      const files = listEventFiles().slice(-30)
      const events: TelemetryEvent[] = []

      for (const file of files) {
        try {
          const content = await readFile(join(TELEMETRY_DIR, file), 'utf-8')
          const lines = content.trim().split('\n').filter(Boolean)
          for (const line of lines) {
            events.push(JSON.parse(line) as TelemetryEvent)
          }
        } catch {
          // skip corrupt files
        }
      }

      return events.slice(-limit)
    },

    async count(): Promise<number> {
      const files = listEventFiles()
      let total = 0

      for (const file of files) {
        try {
          const content = await readFile(join(TELEMETRY_DIR, file), 'utf-8')
          total += content.trim().split('\n').filter(Boolean).length
        } catch {
          // skip
        }
      }

      return total
    },

    async clear(): Promise<void> {
      if (existsSync(TELEMETRY_DIR)) {
        await rm(TELEMETRY_DIR, {recursive: true, force: true})
      }
    },
  }
}

backendsRegistry.push({
  alias: TELEMETRY_BACKEND_TYPES.LOCAL,
  label: 'Local (JSONL on disk)',
  create: createLocalBackend,
})
