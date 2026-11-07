import {isAbsolute, join, resolve} from 'node:path'

export class PathTraversalError extends Error {
  constructor(path: string, projectRoot: string) {
    super(`Path "${path}" resolves outside project root "${projectRoot}"`)
    this.name = 'PathTraversalError'
  }
}

export function safeResolve(projectRoot: string, p: string): string {
  const resolved = isAbsolute(p) ? resolve(p) : resolve(join(projectRoot, p))
  const normalizedRoot = resolve(projectRoot)
  if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
    throw new PathTraversalError(p, projectRoot)
  }
  return resolved
}
