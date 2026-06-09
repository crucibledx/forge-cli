import type {Command, HookEvent} from 'commander'

export interface CommandHook {
  event: HookEvent
  listener: (thisCommand: Command, actionCommand: Command) => void | Promise<void>
}

export interface CommandOption {
  flags: string
  description: string
  defaultValue?: boolean | string | string[]
}

export interface CommandDefinition {
  name: string
  description: string
  options: CommandOption[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (options: any) => Promise<void>
  subcommands?: Omit<CommandDefinition, 'subcommands'>[]
}
