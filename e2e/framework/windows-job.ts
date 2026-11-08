export interface WindowsJob {
  name: string
  assign(pid: number): void
  active(): number
  terminate(): void
  close(): void
}
export const windowsJobs = new Map<number, WindowsJob>()

async function windowsBindings() {
  const {dlopen, ptr} = await import('bun:ffi')
  const native = dlopen('kernel32.dll', {
    CreateJobObjectW: {args: ['ptr', 'ptr'], returns: 'ptr'},
    SetInformationJobObject: {args: ['ptr', 'u32', 'ptr', 'u32'], returns: 'bool'},
    AssignProcessToJobObject: {args: ['ptr', 'ptr'], returns: 'bool'},
    QueryInformationJobObject: {args: ['ptr', 'u32', 'ptr', 'u32', 'ptr'], returns: 'bool'},
    TerminateJobObject: {args: ['ptr', 'u32'], returns: 'bool'},
    OpenProcess: {args: ['u32', 'bool', 'u32'], returns: 'ptr'},
    CloseHandle: {args: ['ptr'], returns: 'bool'},
  })
  return {native, ptr}
}
// Reuse process-scoped FFI bindings; each job still owns and closes its handle.
let bindings: ReturnType<typeof windowsBindings> | undefined

/** Keep the handle, not a leader PID, until the entire owned job is empty. */
export async function createWindowsJob(): Promise<WindowsJob> {
  if (process.platform !== 'win32') throw new Error('Windows job requested on another OS')
  const {native, ptr} = await (bindings ??= windowsBindings())
  const name = `Local\\ForgeTest-${crypto.randomUUID()}`
  const encodedName = Buffer.from(`${name}\0`, 'utf16le')
  const handle = native.symbols.CreateJobObjectW(null, ptr(encodedName))
  if (!handle) {
    throw new Error('Cannot acquire durable Windows Job Object')
  }
  let closed = false
  const close = () => {
    if (!closed) {
      closed = true
      native.symbols.CloseHandle(handle)
    }
  }
  try {
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, x64/arm64 layout.
    const limits = Buffer.alloc(144)
    limits.writeUInt32LE(0x2000, 16) // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
    if (!native.symbols.SetInformationJobObject(handle, 9, ptr(limits), limits.length))
      throw new Error('Cannot set Windows job ownership limits')
  } catch (error) {
    close()
    throw error
  }
  return {
    name,
    assign(pid) {
      if (closed) throw new Error('Windows job is already closed')
      const processHandle = native.symbols.OpenProcess(0x0101, false, pid) // SET_QUOTA | TERMINATE.
      if (!processHandle) throw new Error('Cannot acquire Windows child handle before execution')
      try {
        if (!native.symbols.AssignProcessToJobObject(handle, processHandle))
          throw new Error('Cannot assign Windows child to owned job')
      } finally {
        native.symbols.CloseHandle(processHandle)
      }
    },
    active() {
      if (closed) throw new Error('Windows job is already closed')
      const accounting = Buffer.alloc(48)
      if (!native.symbols.QueryInformationJobObject(handle, 1, ptr(accounting), accounting.length, null))
        throw new Error('Cannot verify Windows job cleanup')
      return accounting.readUInt32LE(40)
    },
    terminate() {
      if (closed) throw new Error('Windows job is already closed')
      if (!native.symbols.TerminateJobObject(handle, 1)) throw new Error('Windows job termination refused')
    },
    close,
  }
}
