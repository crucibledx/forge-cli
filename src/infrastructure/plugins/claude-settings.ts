import type {PluginScope} from '@domain/plugins'

import type {PluginRegistrar} from './registrar'

/** Project scope writes the local file: the marketplace path is absolute and the cache is per machine. */
const CLAUDE_SETTINGS: Readonly<Record<PluginScope, string>> = {
  project: '.claude/settings.local.json',
  user: '.claude/settings.json',
}

/**
 * Spec 0003 §5: Claude Code reads a settings-declared marketplace from a `directory` source and installs its enabled
 * plugins on next start (in a project only once the folder is trusted).
 */
export const registerClaudeSettings: PluginRegistrar = ({scope, marketplace, cacheRoot, plugins}) => ({
  path: CLAUDE_SETTINGS[scope],
  values: [
    {
      key: {kind: 'member', path: ['extraKnownMarketplaces', marketplace]},
      value: {source: {source: 'directory', path: cacheRoot}},
    },
    ...plugins.map((plugin) => ({
      key: {kind: 'member' as const, path: ['enabledPlugins', `${plugin}@${marketplace}`]},
      value: true,
    })),
  ],
})
