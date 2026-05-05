import type {IOService} from '../types'

export const pluginIO: IOService = {
    buildContext: async () => {
        throw new Error('Plugin mode is not implemented in v0.1.')
    },
    resolveProjectRoot: () => {
        throw new Error('Plugin mode is not implemented in v0.1.')
    },
}
