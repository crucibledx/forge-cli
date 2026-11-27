import {SHARED_MESSAGES} from '../shared'

export const SYNC_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSource: 'No source configured',
    noSourceHint: 'Run `forge init` to configure a source',
    noSourceHintExisting: 'Run `forge config` to add a source',
    noHarnesses: 'No harnesses enabled',
    noHarnessesHint: 'Run `forge init` to configure harnesses',
    aliasUndoFailed:
      'Could not undo the `assistants:` → `harnesses:` key rename in .crucible/forge.config.yaml; the config is still valid.',
    sourceFetchFailed: (name: string, error: string) => `Failed to fetch source "${name}": ${error}`,
  },

  progress: {
    syncingSource: (name: string) => `Syncing from source: ${name}`,
  },

  output: {
    wouldSync: (names: string) => `Would sync from: ${names}`,
    dryRunHint: 'Run without --dry-run to apply.',
    strategyBanner: (source: string, local: string) => `Merging (source strategy: ${source}, local strategy: ${local})`,
    done: (count: number, names: string) => `Done. ${count} file(s) synced from ${names}.`,
    notDelivered: (harness: string, glob: string) =>
      `${harness} has no location for ${glob.replace('**', '')} files; they are not delivered to ${harness}.`,
    lastSync: (iso: string) => `Last sync: ${iso.replace('T', ' ').slice(0, 16)}`,
    forced: (item: string) => `--force overrides drift: ${item}`,
  },

  plugins: {
    userInProject: (name: string) =>
      `Plugin scope mismatch: "${name}" has scope: user but is declared in the project config (.crucible/forge.config.yaml)`,
    userInProjectHint:
      'Move the entry to the user config (~/.crucible/forge.config.yaml) and install it with `forge sync --global`',
    projectInUser: (name: string) =>
      `Plugin scope mismatch: "${name}" has scope: project but is declared in the user config (~/.crucible/forge.config.yaml)`,
    projectInUserHint:
      "Move the entry to the project's .crucible/forge.config.yaml and install it with `forge sync` in that project",
    header: (scope: string, marketplace: string, dryRun: boolean) =>
      `Plugins (${scope} scope, marketplace ${marketplace})${dryRun ? ', would install' : ''}:`,
    resolved: 'resolved and locked',
    locked: 'installed from the lock',
    relocked: (reason: string) => `relocked (${reason})`,
    installed: (id: string) => `installed as ${id}`,
    notSupported: (harness: string) => `plugins are not supported for ${harness} yet`,
    notEnabled: (harness: string) => `not enabled in this config; not delivered to ${harness}`,
    notInManifest: (plugin: string, harness: string) =>
      `${plugin} does not list ${harness} in its forge.harnesses; not delivered`,
    removed: 'removed',
    nodeRequired: (plugins: string) =>
      `the generated Droid rules hook of ${plugins} spawns "node", but node is not on PATH on this machine`,
    nodeRequiredHint:
      'Install Node.js (https://nodejs.org) so Droid can run the SessionStart rules hook, or remove the rules from the plugin, then sync again.',
    ruleNotUtf8: (plugin: string, rule: string) =>
      `plugin "${plugin}": rule file ${rule} is not UTF-8 text, so it cannot be delivered to Claude Code byte for byte`,
    ruleNotUtf8Hint: 'Save the rule as UTF-8 in the plugin package, then sync again.',
    variants: 'Variants:',
    compileUpgrade: (harness: string, listed: number, deferred: number) =>
      `forge 0.9 compiles plugins for ${harness}: ${listed} listed, ${deferred} deferred. Set \`compile.enabled: false\` to keep v0.8 output. See docs/compile.md.`,
    recompiled: (harness: string, reason: string) => `recompiled for ${harness}: ${reason}`,
    compileNotSupported: (harness: string) => `compile is not supported for ${harness} yet`,
    lockFromNewerCompiler: (harness: string, compiler: number, current: number) =>
      `The plugin lock's compile[${harness}] was written by compiler ${compiler}, newer than this forge's ${current}; upgrade forge. Nothing was changed.`,
    compileMismatch: (plugin: string, harness: string, manifestPath: string) =>
      `Recompiled output for plugin "${plugin}" (${harness}) does not match the locked outputs, though the compile inputs are unchanged (manifest: ${manifestPath}). Nothing was changed. Report this as a forge bug.`,
  },
} as const
