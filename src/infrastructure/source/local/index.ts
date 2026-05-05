import {existsSync} from 'node:fs'

import type {LocalSource} from '@domain/config/types'

import type {SourceLoaderEntry} from '../types'

export const localLoader: SourceLoaderEntry = {
    alias: 'local',
    label: 'Local directory',
    load: async (source) => {
        const local = source as LocalSource
        const resolvedPath = local.path.replace(/^~/, process.env.HOME ?? '')

        if (!existsSync(resolvedPath)) {
            throw new LocalSourceError(`Local source path does not exist: "${resolvedPath}"`)
        }

        return {localPath: resolvedPath, fresh: true}
    },
}

export class LocalSourceError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'LocalSourceError'
    }
}
