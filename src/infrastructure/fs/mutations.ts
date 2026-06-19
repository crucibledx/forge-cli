import {existsSync} from 'node:fs'
import {mkdir, readFile, symlink, unlink, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join, resolve} from 'node:path'

import type {Mutation} from '@domain/sync/types'
import {MUTATION_TYPES} from '@domain/sync/types'

export class PathTraversalError extends Error {
  constructor(path: string, projectRoot: string) {
    super(`Path "${path}" resolves outside project root "${projectRoot}"`)
    this.name = 'PathTraversalError'
  }
}

export interface AppliedMutation {
  mutation: Mutation
  success: boolean
  previousContent?: string // for rollback of file_write / file_delete
  error?: string
}

export async function applyMutations(projectRoot: string, mutations: Mutation[]): Promise<AppliedMutation[]> {
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

export function safeResolve(projectRoot: string, p: string): string {
  const resolved = isAbsolute(p) ? resolve(p) : resolve(join(projectRoot, p))
  const normalizedRoot = resolve(projectRoot)
  if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
    throw new PathTraversalError(p, projectRoot)
  }
  return resolved
}

type MutationHandler = (root: string, m: Mutation) => Promise<AppliedMutation>

const mutationHandlers: Record<string, MutationHandler> = {
  [MUTATION_TYPES.DIR_CREATE]: async (root, m) => {
    await mkdir(safeResolve(root, m.path), {recursive: true})
    return {mutation: m, success: true}
  },

  [MUTATION_TYPES.FILE_WRITE]: async (root, m) => {
    const mutation = m as Mutation & {content: string}
    const target = safeResolve(root, mutation.path)
    let previousContent: string | undefined

    if (existsSync(target)) {
      previousContent = await readFile(target, 'utf-8')
    }

    await mkdir(dirname(target), {recursive: true})
    await writeFile(target, mutation.content, 'utf-8')
    return {mutation, success: true, previousContent}
  },

  [MUTATION_TYPES.FILE_DELETE]: async (root, m) => {
    const target = safeResolve(root, m.path)
    let previousContent: string | undefined

    if (existsSync(target)) {
      previousContent = await readFile(target, 'utf-8')
      await unlink(target)
    }

    return {mutation: m, success: true, previousContent}
  },

  [MUTATION_TYPES.SYMLINK_CREATE]: async (root, m) => {
    const mutation = m as Mutation & {target: string}
    const linkPath = safeResolve(root, mutation.path)
    await mkdir(dirname(linkPath), {recursive: true})
    await symlink(mutation.target, linkPath)
    return {mutation, success: true}
  },
}

async function applyOne(projectRoot: string, mutation: Mutation): Promise<AppliedMutation> {
  try {
    const handler = mutationHandlers[mutation.type]
    if (!handler) return {mutation, success: false, error: `Unknown mutation type: ${mutation.type}`}
    return await handler(projectRoot, mutation)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {mutation, success: false, error: message}
  }
}
