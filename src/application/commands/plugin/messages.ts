export const PLUGIN_MESSAGES = {
  description: 'Validate harness plugin packages',
  missingSubcommand: 'Specify a plugin subcommand',
  missingSubcommandHint: 'Run `forge plugin validate [path]` to check a plugin package',
  validate: {
    description: 'Validate an Agent Plugins package and report its portability per harness',
    jsonOption: 'Print the result as JSON',
    valid: (name: string, version: string) => `Plugin ${name}@${version} is valid`,
    invalid: (path: string) => `Plugin package is invalid: ${path}`,
    invalidHint: 'Fix the errors above, then run `forge plugin validate` again',
    portability: (harness: string) => `Portability for ${harness}:`,
    allNative: 'every component is delivered natively',
  },
} as const
