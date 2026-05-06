import {existsSync} from 'node:fs'

import type {LocalSource} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'

import {DEFAULT_SOURCE_NAME} from '../constants'
import type {SourceLoaderEntry} from '../types'
import {LOCAL_SOURCE_MESSAGES} from './messages'

export const localLoader: SourceLoaderEntry = {
    alias: 'local',
    label: 'Local directory',
    configure: async () => {
        const path = await prompts.text({
            message: LOCAL_SOURCE_MESSAGES.path.message,
            placeholder: LOCAL_SOURCE_MESSAGES.path.placeholder,
            validate: (val) => {
                if (!val?.trim()) return LOCAL_SOURCE_MESSAGES.path.required
                return undefined
            },
        })
        return {
            name: DEFAULT_SOURCE_NAME,
            type: 'local',
            path: path.trim(),
        } as LocalSource
    },
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
