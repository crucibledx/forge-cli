import {join} from 'node:path'

/** A separate group owner survives a killed test runner; IPC loss triggers independent cleanup. */
export function posixOwnership(command: string[]) {
  let exitCode: number | null = null
  let signalCode: string | null = null
  let finish: (code: number) => void
  let reported = false
  const exited = new Promise<number>((resolve) => {
    finish = resolve
  })
  return {
    command: [process.execPath, join(import.meta.dir, 'posix-supervisor.ts'), JSON.stringify(command)],
    ipc(message: unknown) {
      const value = message as {forgeOwnedExit?: boolean; code: number; signal: string | null; keepOwner: boolean}
      if (!value?.forgeOwnedExit || reported) return
      reported = true
      exitCode = value.code
      signalCode = value.signal
      if (value.keepOwner) finish(value.code)
    },
    wrap<T extends Bun.Subprocess>(proc: T): T {
      void proc.exited.then((code) => {
        if (!reported) {
          exitCode = proc.exitCode
          signalCode = proc.signalCode ? String(proc.signalCode) : null
        }
        finish(exitCode ?? code)
      })
      return new Proxy(proc, {
        get(target, key) {
          if (key === 'exited') return exited
          if (key === 'exitCode') return exitCode
          if (key === 'signalCode') return signalCode
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },
  }
}
