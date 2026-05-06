/**
 * All user-facing prompt messages for `forge init`.
 *
 * Centralised here so tests reference the same strings as the handler.
 * Change text in one place and tests stay in sync automatically.
 */

export const INIT_MESSAGES = {
    intro: 'Forge — AI Environment Setup',
    outro: 'Run `forge sync` to fetch shared skills',
    outroNoSource: 'Done. Add a source to .crucible/forge.config.yaml to enable sync.',
    outroCancelled: 'Cancelled — existing config preserved',

    spinner: {
        scanning: 'Scanning for existing AI configs...',
        scanDone: 'Scan complete',
    },

    detected: 'Detected:',
    configExists: 'Existing .crucible/forge.config.yaml found. Edit it manually or use `forge config` (coming in v0.2).',
    configWrittenTo: (path: string) => `Config written to ${path}`,

    assistants: {
        select: 'Select AI assistants to enable:',
        detectedHint: 'detected',
        detectedGlobalHint: 'detected globally',
        noneSelected: 'No assistants selected — edit .crucible/forge.config.yaml to add some later.',
    },

    source: {
        addSource: 'Add a shared skills source?',
        selectType: 'Source type:',
    },

    sync: {
        runNow: 'Run forge sync now?',
    },
} as const
