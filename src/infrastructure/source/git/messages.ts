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
  verify: {
    checking: 'Verifying source is reachable...',
    success: 'Source verified',
    failed: 'Could not verify source',
    unreachable: (error: string) =>
      `Source unreachable — ${error}\nFix access and run \`forge sync --dry-run\` to verify later.`,
  },
} as const
