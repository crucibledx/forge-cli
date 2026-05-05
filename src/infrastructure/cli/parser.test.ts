import {describe, expect, it, spyOn} from 'bun:test'

import type {CommandDefinition} from '@application/commands/types'

import {createProgram, PROGRAM_DETAILS} from './parser'
import * as renderer from './renderer'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeCmd(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
    return {
        name: 'test-cmd',
        description: 'A test command',
        options: [],
        action: async () => {
        },
        ...overrides,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createProgram', () => {
    it('sets program name from COMMON_MESSAGES', () => {
        const program = createProgram([])
        expect(program.name()).toBe(PROGRAM_DETAILS.name)
    })

    it('sets program description from COMMON_MESSAGES', () => {
        const program = createProgram([])
        expect(program.description()).toBe(PROGRAM_DETAILS.description)
    })

    it('registers a command with the correct name', () => {
        const program = createProgram([makeCmd({name: 'greet'})])
        const names = program.commands.map((c) => c.name())
        expect(names).toContain('greet')
    })

    it('registers a command with the correct description', () => {
        const program = createProgram([makeCmd({name: 'greet', description: 'Say hello'})])
        const cmd = program.commands.find((c) => c.name() === 'greet')
        expect(cmd?.description()).toBe('Say hello')
    })

    it('registers multiple commands', () => {
        const program = createProgram([
            makeCmd({name: 'init'}),
            makeCmd({name: 'sync'}),
        ])
        const names = program.commands.map((c) => c.name())
        expect(names).toContain('init')
        expect(names).toContain('sync')
    })

    it('registers command options', () => {
        const program = createProgram([
            makeCmd({
                name: 'init',
                options: [{flags: '-v, --verbose', description: 'Verbose output', defaultValue: false}],
            }),
        ])
        const cmd = program.commands.find((c) => c.name() === 'init')!
        const optionFlags = cmd.options.map((o) => o.flags)
        expect(optionFlags.some((f) => f.includes('--verbose'))).toBe(true)
    })

    it('calls command action when invoked', async () => {
        let called = false
        const program = createProgram([makeCmd({
            name: 'run', action: async () => {
                called = true
            }
        })])
        await program.parseAsync(['run'], {from: 'user'})
        expect(called).toBe(true)
    })

    it('renders error and exits with code 1 when action throws', async () => {
        const renderErrorSpy = spyOn(renderer, 'renderError').mockImplementation(() => {
        })
        const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        }) as never)

        const program = createProgram([
            makeCmd({
                name: 'boom', action: async () => {
                    throw new Error('kaboom')
                }
            }),
        ])
        await program.parseAsync(['boom'], {from: 'user'})

        expect(renderErrorSpy).toHaveBeenCalledWith('kaboom')
        expect(exitSpy).toHaveBeenCalledWith(1)

        renderErrorSpy.mockRestore()
        exitSpy.mockRestore()
    })

    it('renders stringified error when non-Error is thrown', async () => {
        const renderErrorSpy = spyOn(renderer, 'renderError').mockImplementation(() => {
        })
        const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
        }) as never)

        const program = createProgram([
            makeCmd({
                name: 'bomb', action: async () => {
                    throw 'plain string error'
                }
            }),
        ])
        await program.parseAsync(['bomb'], {from: 'user'})

        expect(renderErrorSpy).toHaveBeenCalledWith('plain string error')
        expect(exitSpy).toHaveBeenCalledWith(1)

        renderErrorSpy.mockRestore()
        exitSpy.mockRestore()
    })
})
