import type {PluginScope} from '@domain/plugins'

import type {KeyedValue} from '../config/keyed-merge'

/** What a harness registrar needs to point the harness at one scope's local marketplace. */
export interface PluginRegistrationInput {
  scope: PluginScope
  /** Marketplace name for this cache root (`marketplaceName`). */
  marketplace: string
  /** Absolute path of the scope's plugin cache root, which is the marketplace directory. */
  cacheRoot: string
  /** Names of the plugins delivered to this harness in this scope. */
  plugins: readonly string[]
}

/** Keys forge owns in one harness settings file; `path` is relative to the sync root (project root or home). */
export interface PluginRegistration {
  path: string
  values: KeyedValue[]
}

/** Spec 0003 §5: file-only, runs no harness CLI. */
export type PluginRegistrar = (input: PluginRegistrationInput) => PluginRegistration
