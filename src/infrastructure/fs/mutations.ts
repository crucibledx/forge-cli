import {existsSync} from 'node:fs'
import {mkdir, readFile, symlink, unlink, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join} from 'node:path'

import type {Mutation} from '@domain/sync/types'

export interface AppliedMutation {
    mutation: Mutation
    success: boolean
    previousContent?: string // for rollback of file_write / file_delete
    error?: string
}

export async function applyMutations(
    projectRoot: string,
    mutations: Mutation[],
): Promise<AppliedMutation[]> {
    const applied: AppliedMutation[] = []

    for (const mutation of mutations) {
        const result = await applyOne(projectRoot, mutation)
        applied.push(result)

        if (!result.success) {
            break // stop on first error — caller can rollback
        }
    }

    return applied
}

function resolve(projectRoot: string, p: string): string {
    return isAbsolute(p) ? p : join(projectRoot, p)
}

async function applyOne(
    projectRoot: string,
    mutation: Mutation,
): Promise<AppliedMutation> {
    try {
        switch (mutation.type) {
            case 'dir_create': {
                const target = resolve(projectRoot, mutation.path)
                await mkdir(target, {recursive: true})
                return {mutation, success: true}
            }

            case 'file_write': {
                const target = resolve(projectRoot, mutation.path)
                let previousContent: string | undefined

                if (existsSync(target)) {
                    previousContent = await readFile(target, 'utf-8')
                }

                await mkdir(dirname(target), {recursive: true})
                await writeFile(target, mutation.content, 'utf-8')
                return {mutation, success: true, previousContent}
            }

            case 'file_delete': {
                const target = resolve(projectRoot, mutation.path)
                let previousContent: string | undefined

                if (existsSync(target)) {
                    previousContent = await readFile(target, 'utf-8')
                    await unlink(target)
                }

                return {mutation, success: true, previousContent}
            }

            case 'symlink_create': {
                const linkPath = resolve(projectRoot, mutation.path)
                await mkdir(dirname(linkPath), {recursive: true})
                await symlink(mutation.target, linkPath)
                return {mutation, success: true}
            }
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {mutation, success: false, error: message}
    }
}
