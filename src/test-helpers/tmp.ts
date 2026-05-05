import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach} from 'bun:test'

// ─── Path constants (reused across unit + e2e tests) ─────────────────────────

export const CRUCIBLE_DIR = '.crucible'
export const CONFIG_FILE = 'forge.config.yaml'

export function crucibleDirPath(root: string): string {
    return join(root, CRUCIBLE_DIR)
}

export function configFilePath(root: string): string {
    return join(root, CRUCIBLE_DIR, CONFIG_FILE)
}

// ─── Temp directory lifecycle ─────────────────────────────────────────────────

/**
 * Registers beforeEach/afterEach hooks that create and destroy an isolated
 * temp directory per test. Returns a getter so tests always read the current
 * value set by the most recent beforeEach.
 *
 * @param prefix  Short label used in the directory name for easy identification.
 * @param base    Parent directory. Defaults to the OS temp dir (`os.tmpdir()`).
 *                Unit tests pass `import.meta.dir` to keep dirs project-local.
 *
 * Usage (e2e — system tmpdir):
 *   const getDir = useTmpDir('forge-e2e')
 *
 * Usage (unit — project-local):
 *   const getDir = useTmpDir('config', import.meta.dir)
 */
export function useTmpDir(prefix: string, base: string = tmpdir()): () => string {
    let dir = ''

    beforeEach(async () => {
        dir = join(base, `__tmp_${prefix}_${Date.now()}__`)
        await mkdir(dir, {recursive: true})
    })

    afterEach(async () => {
        await rm(dir, {recursive: true, force: true})
    })

    return () => dir
}
