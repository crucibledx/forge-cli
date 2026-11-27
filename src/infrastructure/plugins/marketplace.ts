import {createHash} from 'node:crypto'

import type {PluginHarnessId, PluginLockEntry, PluginScope} from '@domain/plugins'
import {PLUGIN_HARNESSES, PLUGIN_SCOPES} from '@domain/plugins'

/** Catalog file per harness, relative to the cache root (spec 0003 §5). */
export const MARKETPLACE_CATALOGS: Readonly<Record<PluginHarnessId, string>> = {
  [PLUGIN_HARNESSES.CLAUDE_CODE]: '.claude-plugin/marketplace.json',
  [PLUGIN_HARNESSES.DROID]: '.factory-plugin/marketplace.json',
}

/**
 * Each cache root is its own marketplace: harnesses resolve a same-name marketplace from one settings file whole, so a
 * project name must differ from the user name and from every other project's. `root` is the canonical absolute path.
 */
export function marketplaceName(scope: PluginScope, root: string): string {
  if (scope === PLUGIN_SCOPES.USER) return 'crucible-forge-user'
  return `crucible-forge-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`
}

/** A catalog listing the plugins delivered to `harness`, each pointing at that harness's own emitted tree. */
export function marketplaceCatalog(name: string, harness: string, plugins: readonly PluginLockEntry[]): string {
  const catalog = {
    name,
    owner: {name: 'Crucible Forge'},
    plugins: plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      source: `./${plugin.name}/${plugin.version}/${harness}`,
    })),
  }
  return JSON.stringify(catalog, null, 2) + '\n'
}
