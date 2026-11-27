import type {PluginScope} from '@domain/plugins'

import type {PluginRegistrar} from './registrar'

const DROID_SETTINGS: Readonly<Record<PluginScope, string>> = {
  project: '.factory/settings.local.json',
  user: '.factory/settings.json',
}

/** Spec 0003 §5: Droid reads a settings-declared marketplace from a local directory under the key it is declared with. */
export const registerDroidSettings: PluginRegistrar = ({scope, marketplace, cacheRoot, plugins}) => ({
  path: DROID_SETTINGS[scope],
  values: [
    {
      key: {kind: 'member', path: ['extraKnownMarketplaces', marketplace]},
      value: {source: {source: 'local', path: cacheRoot}},
    },
    ...plugins.map((plugin) => ({
      key: {kind: 'member' as const, path: ['enabledPlugins', `${plugin}@${marketplace}`]},
      value: true,
    })),
  ],
})

const notImplemented =
  (id: string): PluginRegistrar =>
  () => {
    throw new Error(`Plugin registrar '${id}' is not implemented yet`)
  }

/** Keyed by `HarnessPluginCapability.register` (spec 0003 §5). Entries are kept apart so each registrar lands on its own. */
export const PLUGIN_REGISTRARS: Readonly<Record<string, PluginRegistrar>> = {
  'claude-settings': notImplemented('claude-settings'),

  'droid-settings': registerDroidSettings,
}
