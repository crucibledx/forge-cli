import {constants} from 'node:fs'
import {access, chmod, lstat, mkdir, open, readFile, rename, rmdir, unlink} from 'node:fs/promises'
import {dirname, join, relative} from 'node:path'

import {createConfinement} from './confinement'
import type {TemporaryFile} from './windows-access'
import {
  checkDirectoryCreationAccess,
  checkPrivateTemporarySupport,
  openPrivateTemporary,
  privateAccessMetadata,
  readAccessMetadata,
  writeAccessMetadata,
} from './windows-access'

export interface FileOperation {
  path: string
  content: string | Uint8Array | null
  private?: boolean
  backup?: boolean
}

async function checkReplacementSupport(): Promise<void> {
  if (process.platform !== 'win32') return
  const {dlopen} = await import('bun:ffi')
  const native = dlopen('kernel32.dll', {
    ReplaceFileW: {args: ['ptr', 'ptr', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'bool'},
  })
  native.close()
}

async function replace(temp: string, path: string, existed: boolean): Promise<void> {
  if (process.platform !== 'win32' || !existed) return rename(temp, path)
  // ReplaceFileW retains the destination's DACL. A rename-overwrite does not.
  // No fallback that could discard access controls or clear read-only attributes.
  const {dlopen, ptr} = await import('bun:ffi')
  const native = dlopen('kernel32.dll', {
    ReplaceFileW: {args: ['ptr', 'ptr', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'bool'},
  })
  try {
    const target = Buffer.from(`${path}\0`, 'utf16le')
    const source = Buffer.from(`${temp}\0`, 'utf16le')
    if (!native.symbols.ReplaceFileW(ptr(target), ptr(source), null, 0, null, null)) {
      throw new Error(`Access-preserving replacement refused: ${path}`)
    }
  } finally {
    native.close()
  }
}

export const transactionIO = {
  access,
  lstat,
  readFile,
  chmod,
  mkdir,
  rmdir,
  unlink,
  replace,
  readAccessMetadata,
  writeAccessMetadata,
  privateAccessMetadata,
  checkPrivateTemporarySupport,
  checkDirectoryCreationAccess,
  async openTemp(path: string): Promise<TemporaryFile> {
    return process.platform === 'win32' ? openPrivateTemporary(path) : open(path, 'wx', 0o600)
  },
  async writeTemp(path: string, bytes: Uint8Array): Promise<void> {
    const file = await this.openTemp(path)
    try {
      await file.writeFile(bytes)
    } finally {
      await file.close()
    }
  },
}

export type TransactionIO = typeof transactionIO
interface Snapshot {
  bytes: Uint8Array | null
  mode: number
  access: Uint8Array | null
}

export class TransactionError extends Error {
  constructor(
    original: unknown,
    readonly unrestored: string[],
    readonly recoveryFiles: string[] = [],
  ) {
    super(
      `${original instanceof Error ? original.message : String(original)}. ${
        unrestored.length ? `Recovery incomplete; unrestored/untrusted: ${unrestored.join(', ')}` : 'Rollback complete'
      }`,
    )
    this.name = 'TransactionError'
  }
}

/** Prepare is read-only. Commit is in operation order, with metadata last. */
export async function prepareTransaction(root: string, operations: FileOperation[], fs = transactionIO) {
  const boundary = await createConfinement(root)
  await fs.checkPrivateTemporarySupport()
  const snapshots = new Map<string, Snapshot>()
  const absentDirectories = new Set<string>()
  for (const operation of operations) {
    const path = await boundary.resolve(operation.path)
    if (snapshots.has(path)) throw new Error(`Competing transaction operation: ${operation.path}`)
    try {
      const stat = await fs.lstat(path)
      if (!stat.isFile()) throw new Error(`Not a regular file: ${operation.path}`)
      if (process.platform === 'win32' && !(stat.mode & 0o222)) throw new Error(`Read-only file: ${operation.path}`)
      snapshots.set(path, {
        bytes: await fs.readFile(path),
        mode: stat.mode & 0o7777,
        access: await fs.readAccessMetadata(path),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      snapshots.set(path, {
        bytes: null,
        mode: operation.private ? 0o600 : 0o666 & ~process.umask(),
        access: operation.private ? await fs.privateAccessMetadata() : null,
      })
    }
    if (operation.content === null && snapshots.get(path)!.bytes === null) continue
    let parent = dirname(path)
    let needsDirectoryCreation = false
    while (true) {
      try {
        const stat = await fs.lstat(parent)
        if (!stat.isDirectory()) throw new Error(`Not a directory: ${relative(boundary.root, parent)}`)
        if (process.platform === 'win32') await fs.checkDirectoryCreationAccess(parent, needsDirectoryCreation)
        else await fs.access(parent, constants.W_OK | constants.X_OK)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (parent === boundary.root) throw error
        absentDirectories.add(parent)
        needsDirectoryCreation = true
      }
      parent = dirname(parent)
    }
  }
  const touched: string[] = []
  if (process.platform === 'win32' && [...snapshots.values()].some((snapshot) => snapshot.bytes !== null)) {
    // Unsupported native access-preserving replacement must fail during
    // read-only preparation, not after earlier targets have been installed.
    await checkReplacementSupport()
  }
  const temporaries = new Set<string>()
  const recoveryTemporaries = new Set<string>()
  const attemptedDirectories: string[] = []
  const directories = [...absentDirectories].sort((a, b) => a.length - b.length)
  const remove = async (path: string) => {
    await boundary.resolve(path)
    try {
      await fs.unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const write = async (path: string, bytes: Uint8Array, mode: number, existed: boolean, recovery = false) => {
    await boundary.resolve(path)
    const temporary = join(dirname(path), `.forge-${crypto.randomUUID()}.tmp`)
    temporaries.add(temporary)
    if (recovery) recoveryTemporaries.add(temporary)
    await boundary.resolve(temporary)
    await fs.writeTemp(temporary, bytes)
    await fs.chmod(temporary, mode)
    const access = snapshots.get(path)!.access
    if (access !== null) await fs.writeAccessMetadata(temporary, access)
    await fs.replace(temporary, path, existed)
    temporaries.delete(temporary)
    recoveryTemporaries.delete(temporary)
  }
  return {
    async commit(): Promise<void> {
      try {
        for (const dir of directories) {
          await boundary.resolve(dir)
          attemptedDirectories.push(dir)
          await fs.mkdir(dir, {mode: 0o700})
        }
        for (const operation of operations) {
          const path = await boundary.resolve(operation.path)
          const snapshot = snapshots.get(path)!
          // Include the failing operation, even if it threw after touching disk.
          touched.push(path)
          if (operation.content === null) await remove(path)
          else
            await write(
              path,
              typeof operation.content === 'string' ? Buffer.from(operation.content) : operation.content,
              snapshot.mode,
              snapshot.bytes !== null,
            )
        }
      } catch (error) {
        const unrestored: string[] = []
        for (const path of [...touched].reverse()) {
          const snapshot = snapshots.get(path)!
          try {
            if (snapshot.bytes === null) await remove(path)
            else {
              const present = await fs.lstat(await boundary.resolve(path)).then(
                () => true,
                (err) => {
                  if (err.code === 'ENOENT') return false
                  throw err
                },
              )
              await write(path, snapshot.bytes, snapshot.mode, present, true)
            }
          } catch {
            unrestored.push(relative(boundary.root, path).replaceAll('\\', '/'))
          }
        }
        // If restoration is incomplete, keep available recovery backups.
        if (unrestored.length) {
          for (const operation of operations.filter((op) => op.backup)) {
            try {
              const path = await boundary.resolve(operation.path)
              if (operation.content !== null) {
                await write(
                  path,
                  typeof operation.content === 'string' ? Buffer.from(operation.content) : operation.content,
                  snapshots.get(path)!.mode,
                  snapshots.get(path)!.bytes !== null,
                )
              }
            } catch {
              unrestored.push(operation.path)
            }
          }
        }
        for (const path of temporaries) {
          if (unrestored.length && recoveryTemporaries.has(path)) continue
          try {
            await remove(path)
          } catch {
            unrestored.push(relative(boundary.root, path).replaceAll('\\', '/'))
          }
        }
        for (const dir of [...attemptedDirectories].reverse()) {
          try {
            await boundary.resolve(dir)
            await fs.rmdir(dir)
          } catch (err) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((err as NodeJS.ErrnoException).code ?? '')) {
              unrestored.push(relative(boundary.root, dir).replaceAll('\\', '/'))
            }
          }
        }
        throw new TransactionError(
          error,
          [...new Set(unrestored)],
          [...recoveryTemporaries].map((path) => relative(boundary.root, path).replaceAll('\\', '/')),
        )
      }
    },
  }
}
