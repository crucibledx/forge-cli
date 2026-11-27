export const PLUGIN_CONFIG_ERRORS = {
  REF_CONFLICT: 'PLUGIN_SOURCE_REF_CONFLICT',
  REMAP: 'PLUGIN_SOURCE_REMAP',
  SHORT_SHA: 'PLUGIN_SOURCE_SHORT_SHA',
  UNKNOWN_HARNESS: 'PLUGIN_UNKNOWN_HARNESS',
} as const

export class PluginSourceError extends Error {
  constructor(
    readonly plugin: string,
    detail: string,
  ) {
    super(`Plugin "${plugin}" source error: ${detail}`)
    this.name = 'PluginSourceError'
  }
}

export class PluginValidationError extends Error {
  constructor(
    readonly plugin: string,
    readonly errors: string[],
  ) {
    super(`Plugin "${plugin}" failed validation:\n${errors.map((error) => `  ${error}`).join('\n')}`)
    this.name = 'PluginValidationError'
  }
}

export class PluginCacheError extends Error {
  constructor(
    readonly cacheRoot: string,
    detail: string,
  ) {
    super(`Cannot read the plugin cache at ${cacheRoot}: ${detail}`)
    this.name = 'PluginCacheError'
  }
}

export class PluginLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginLockError'
  }
}
