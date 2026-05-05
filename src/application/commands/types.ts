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
}
