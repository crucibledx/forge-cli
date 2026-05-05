/**
 * All user-facing prompt messages for `forge init`.
 *
 * Centralised here so tests reference the same strings as the handler.
 * Change text in one place and tests stay in sync automatically.
 */

export const INIT_MESSAGES = {
    intro: 'Forge — AI Environment Setup',
    outro: 'Run `forge sync` to fetch shared skills',
    outroCancelled: 'Cancelled — existing config preserved',

    spinner: {
        scanning: 'Scanning for existing AI configs...',
        scanDone: 'Scan complete',
    },

    detected: 'Detected:',
    existingConfig: 'Existing .crucible/forge.config.yaml found',
    configWrittenTo: (path: string) => `Config written to ${path}`,

    overwriteExisting: 'Overwrite existing config?',

    assistants: {
        keepDetected: (name: string) => `Keep ${name}?`,
        addUndetected: (name: string) => `Add ${name}?`,
    },

    source: {
        addSource: 'Add a shared skills source?',
        url: {
            message: 'Source git URL (SSH or HTTPS):',
            placeholder: 'git@github.com:your-org/ai-configs.git',
            required: 'URL is required',
        },
        branch: 'Branch:',
        subdirectory: {
            message: 'Subdirectory within repo (optional):',
            placeholder: 'leave empty for repo root'
        },
        defaultName: 'team-shared',
    },

    sync: {
        runNow: 'Run forge sync now?',
    },
} as const
