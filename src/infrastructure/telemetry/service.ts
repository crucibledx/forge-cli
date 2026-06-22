import {homedir, platform} from 'node:os'

import type {ProjectConfig, TelemetryConfig} from '@domain/config/types'
import {TELEMETRY_DEFAULTS} from '@domain/config/types'
import {isGlobalMode} from '@domain/scope'
import {loadProjectConfig} from '@infrastructure/config'

import pkg from '../../../package.json'
import type {TelemetryBackend, TelemetryBackendType} from './backend'
import {backendsRegistry, TELEMETRY_BACKEND_TYPES} from './backend'
import type {TelemetryEvent, TelemetryService} from './types'

const FORGE_VERSION = pkg.version

// ─── Config Resolution ──────────────────────────────────────────────────────

export function resolveTelemetryConfig(
  globalConfig: ProjectConfig | null,
  projectConfig: ProjectConfig | null,
): TelemetryConfig {
  return {
    ...TELEMETRY_DEFAULTS,
    ...globalConfig?.telemetry,
    ...projectConfig?.telemetry,
  }
}

// ─── Backend Resolution ─────────────────────────────────────────────────────

export function getBackend(type: TelemetryBackendType = TELEMETRY_BACKEND_TYPES.LOCAL): TelemetryBackend {
  const entry = backendsRegistry.find((b) => b.alias === type)
  if (!entry) {
    const fallback = backendsRegistry.find((b) => b.alias === TELEMETRY_BACKEND_TYPES.LOCAL)
    if (!fallback) throw new Error('No telemetry backends registered')
    return fallback.create()
  }
  return entry.create()
}

// ─── Service Factory ────────────────────────────────────────────────────────

export async function createTelemetryService(): Promise<TelemetryService> {
  const globalRoot = homedir()
  const projectRoot = isGlobalMode() ? globalRoot : process.cwd()
  const globalConfig = await loadProjectConfig(globalRoot)
  const projectConfig = projectRoot !== globalRoot ? await loadProjectConfig(projectRoot) : null
  const config = resolveTelemetryConfig(globalConfig, projectConfig)
  const backend = getBackend(config.backend as TelemetryBackendType)

  return buildTelemetryService(config.enabled, backend)
}

export function buildTelemetryService(enabled: boolean, backend: TelemetryBackend): TelemetryService {
  return {
    async track(event): Promise<void> {
      if (!enabled) return

      const full: TelemetryEvent = {
        ts: new Date().toISOString(),
        forge_version: FORGE_VERSION,
        os: platform(),
        ...event,
      }
      await backend.write(full)
    },

    async readEvents(limit?: number): Promise<TelemetryEvent[]> {
      return backend.readAll(limit)
    },

    async eventCount(): Promise<number> {
      return backend.count()
    },

    async clear(): Promise<void> {
      await backend.clear()
    },

    getStorageDir(): string {
      return backend.storageDir
    },
  }
}
