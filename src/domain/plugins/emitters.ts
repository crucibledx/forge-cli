import {emitFactory, FACTORY_PRINT_RULES_FILE} from './emit/factory'
import type {DeliveredFiles, PluginPackage} from './types'

/** Builds what one harness loads from a parsed package. Pure: the engine hashes, caches and writes the result. */
export type PluginEmitter = (pkg: PluginPackage) => DeliveredFiles

const notImplemented =
  (id: string): PluginEmitter =>
  () => {
    throw new Error(`Plugin emitter '${id}' is not implemented yet`)
  }

export {FACTORY_PRINT_RULES_FILE}

/** Keyed by `HarnessPluginCapability.emit` (spec 0003 §5). Entries are kept apart so each emitter lands on its own. */
export const PLUGIN_EMITTERS: Readonly<Record<string, PluginEmitter>> = {
  claude: notImplemented('claude'),

  factory: emitFactory,
}
