export const GIT_SOURCE_MESSAGES = {
    url: {
        message: 'Source git URL (SSH or HTTPS):',
        placeholder: 'git@github.com:your-org/ai-configs.git',
        required: 'URL is required',
    },
    branch: 'Branch:',
    subdirectory: {
        message: 'Subdirectory within repo (optional):',
        placeholder: 'leave empty for repo root',
    },
} as const
