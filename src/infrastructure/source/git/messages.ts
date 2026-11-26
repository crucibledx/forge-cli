export const GIT_SOURCE_MESSAGES = {
  url: {
    message: 'Source git URL (SSH or HTTPS):',
    placeholder: 'git@github.com:your-org/ai-configs.git',
    required: 'URL is required',
  },
  branch: 'Branch, tag or commit SHA:',
  refNotFound: (name: string) => `Remote has no branch or tag named "${name}"`,
  notCommit: (sha: string) => `Remote object ${sha} is not a commit`,
  optionLike: (field: 'url' | 'branch') => `Git source ${field} must not start with '-'`,
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
