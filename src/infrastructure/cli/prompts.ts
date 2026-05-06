import * as clack from '@clack/prompts'
import pc from 'picocolors'

export async function select(options: {
    message: string
    options: Array<{value: string, label?: string, hint?: string}>
}): Promise<string> {
    const result = await clack.select({
        message: options.message,
        options: options.options as Array<{value: string, label?: string, hint?: string}>,
    })

    if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(0)
    }

    return result
}

export async function multiselect(options: {
    message: string
    options: Array<{value: string, label?: string, hint?: string}>
    initialValues?: string[]
    required?: boolean
}): Promise<string[]> {
    const result = await clack.multiselect({
        message: options.message,
        options: options.options as Array<{value: string, label?: string, hint?: string}>,
        initialValues: options.initialValues,
        required: options.required ?? false,
    })

    if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(0)
    }

    return result as string[]
}

export async function text(options: {
    message: string
    placeholder?: string
    defaultValue?: string
    validate?: (value: string | undefined) => string | undefined
}): Promise<string> {
    const result = await clack.text({
        message: options.message,
        placeholder: options.placeholder,
        defaultValue: options.defaultValue,
        validate: options.validate,
    })

    if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(0)
    }

    return result as string
}

export async function confirm(options: {
    message: string
    initialValue?: boolean
}): Promise<boolean> {
    const result = await clack.confirm({
        message: options.message,
        initialValue: options.initialValue ?? true,
    })

    if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(0)
    }

    return result as boolean
}

export function intro(message: string): void {
    clack.intro(pc.bold(message))
}

export function outro(message: string): void {
    clack.outro(message)
}

export function spinner(): ReturnType<typeof clack.spinner> {
    return clack.spinner()
}

export const log = clack.log
