import {join} from 'node:path'

export const CLI_ENTRY = join(import.meta.dir, '..', '..', 'src', 'main.ts')
export const TIMEOUT_MS = 20_000
