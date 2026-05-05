import {describe, expect, it, mock, spyOn} from 'bun:test'

import * as clack from '@clack/prompts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockClackValue<T>(value: T): void {
    spyOn(clack, 'isCancel').mockReturnValue(false)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('prompts wrappers', () => {
    describe('confirm', () => {
        it('returns true when clack resolves true', async () => {
            spyOn(clack, 'confirm').mockResolvedValue(true as never)
            spyOn(clack, 'isCancel').mockReturnValue(false)

            const {confirm} = await import('./prompts')
            const result = await confirm({message: 'Continue?'})
            expect(result).toBe(true)
        })

        it('returns false when clack resolves false', async () => {
            spyOn(clack, 'confirm').mockResolvedValue(false as never)
            spyOn(clack, 'isCancel').mockReturnValue(false)

            const {confirm} = await import('./prompts')
            const result = await confirm({message: 'Continue?'})
            expect(result).toBe(false)
        })

        it('calls process.exit(0) on cancel', async () => {
            spyOn(clack, 'confirm').mockResolvedValue(Symbol('clack:cancel') as never)
            spyOn(clack, 'isCancel').mockReturnValue(true)
            spyOn(clack, 'cancel').mockImplementation(() => {
            })
            const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            }) as never)

            const {confirm} = await import('./prompts')
            await confirm({message: 'Continue?'})

            expect(exitSpy).toHaveBeenCalledWith(0)
            exitSpy.mockRestore()
        })
    })

    describe('text', () => {
        it('returns the entered string', async () => {
            spyOn(clack, 'text').mockResolvedValue('hello' as never)
            spyOn(clack, 'isCancel').mockReturnValue(false)

            const {text} = await import('./prompts')
            const result = await text({message: 'Enter name:'})
            expect(result).toBe('hello')
        })

        it('calls process.exit(0) on cancel', async () => {
            spyOn(clack, 'text').mockResolvedValue(Symbol('clack:cancel') as never)
            spyOn(clack, 'isCancel').mockReturnValue(true)
            spyOn(clack, 'cancel').mockImplementation(() => {
            })
            const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            }) as never)

            const {text} = await import('./prompts')
            await text({message: 'Enter name:'})

            expect(exitSpy).toHaveBeenCalledWith(0)
            exitSpy.mockRestore()
        })
    })

    describe('select', () => {
        it('returns the selected value', async () => {
            spyOn(clack, 'select').mockResolvedValue('option-a' as never)
            spyOn(clack, 'isCancel').mockReturnValue(false)

            const {select} = await import('./prompts')
            const result = await select({
                message: 'Pick one:',
                options: [{value: 'option-a', label: 'Option A'}],
            })
            expect(result).toBe('option-a')
        })

        it('calls process.exit(0) on cancel', async () => {
            spyOn(clack, 'select').mockResolvedValue(Symbol('clack:cancel') as never)
            spyOn(clack, 'isCancel').mockReturnValue(true)
            spyOn(clack, 'cancel').mockImplementation(() => {
            })
            const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            }) as never)

            const {select} = await import('./prompts')
            await select({message: 'Pick one:', options: [{value: 'a'}]})

            expect(exitSpy).toHaveBeenCalledWith(0)
            exitSpy.mockRestore()
        })
    })

    describe('multiselect', () => {
        it('returns the selected values array', async () => {
            spyOn(clack, 'multiselect').mockResolvedValue(['a', 'b'] as never)
            spyOn(clack, 'isCancel').mockReturnValue(false)

            const {multiselect} = await import('./prompts')
            const result = await multiselect({
                message: 'Pick many:',
                options: [{value: 'a'}, {value: 'b'}],
            })
            expect(result).toEqual(['a', 'b'])
        })

        it('calls process.exit(0) on cancel', async () => {
            spyOn(clack, 'multiselect').mockResolvedValue(Symbol('clack:cancel') as never)
            spyOn(clack, 'isCancel').mockReturnValue(true)
            spyOn(clack, 'cancel').mockImplementation(() => {
            })
            const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            }) as never)

            const {multiselect} = await import('./prompts')
            await multiselect({message: 'Pick many:', options: [{value: 'a'}]})

            expect(exitSpy).toHaveBeenCalledWith(0)
            exitSpy.mockRestore()
        })
    })

    describe('intro', () => {
        it('calls clack.intro with bold-wrapped message', async () => {
            const introSpy = spyOn(clack, 'intro').mockImplementation(() => {
            })

            const {intro} = await import('./prompts')
            intro('Hello World')

            expect(introSpy).toHaveBeenCalledTimes(1)
            const arg = introSpy.mock.calls[0][0] as string
            expect(arg).toContain('Hello World')
            introSpy.mockRestore()
        })
    })

    describe('outro', () => {
        it('calls clack.outro with the message', async () => {
            const outroSpy = spyOn(clack, 'outro').mockImplementation(() => {
            })

            const {outro} = await import('./prompts')
            outro('Bye!')

            expect(outroSpy).toHaveBeenCalledWith('Bye!')
            outroSpy.mockRestore()
        })
    })

    describe('spinner', () => {
        it('returns the clack spinner instance', async () => {
            const spinnerSpy = spyOn(clack, 'spinner')

            const {spinner} = await import('./prompts')
            spinner()

            expect(spinnerSpy).toHaveBeenCalledTimes(1)
            spinnerSpy.mockRestore()
        })
    })
})
