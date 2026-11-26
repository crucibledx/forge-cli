import type {IOService} from '../types'

export const extensionIO: IOService = {
  buildContext: async () => {
    throw new Error('Extension mode is not implemented in v0.1.')
  },
  resolveProjectRoot: () => {
    throw new Error('Extension mode is not implemented in v0.1.')
  },
}
