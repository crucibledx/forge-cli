/** Trusted gate: no target exists until the parent owns this bootstrap's job. */
if (process.platform !== 'win32' || (await Bun.stdin.text()) !== 'forge-owned-go\n') process.exit(125)
const packet: {executable: string; command: string; cwd: string; job: string} = JSON.parse(
  Buffer.from(Bun.argv[2], 'base64').toString(),
)
const {dlopen, ptr} = await import('bun:ffi')
const native = dlopen('kernel32.dll', {
  OpenProcess: {args: ['u32', 'bool', 'u32'], returns: 'ptr'},
  GetStdHandle: {args: ['i32'], returns: 'ptr'},
  DuplicateHandle: {args: ['ptr', 'ptr', 'ptr', 'ptr', 'u32', 'bool', 'u32'], returns: 'bool'},
  CreateFileW: {args: ['ptr', 'u32', 'u32', 'ptr', 'u32', 'u32', 'ptr'], returns: 'u64'},
  CreateProcessW: {args: ['ptr', 'ptr', 'ptr', 'ptr', 'bool', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'bool'},
  OpenJobObjectW: {args: ['u32', 'bool', 'ptr'], returns: 'ptr'},
  IsProcessInJob: {args: ['ptr', 'ptr', 'ptr'], returns: 'bool'},
  ResumeThread: {args: ['ptr'], returns: 'u32'},
  WaitForSingleObject: {args: ['ptr', 'u32'], returns: 'u32'},
  GetExitCodeProcess: {args: ['ptr', 'ptr'], returns: 'bool'},
  TerminateProcess: {args: ['ptr', 'u32'], returns: 'bool'},
  CloseHandle: {args: ['ptr'], returns: 'bool'},
  GetLastError: {args: [], returns: 'u32'},
})
const wide = (value: string) => Buffer.from(value + '\0', 'utf16le')
const handles: bigint[] = []
const child = Buffer.alloc(24)
let resumed = false,
  exitCode = 125
const check = (success: unknown) => {
  if (!success) throw new Error(`Windows owned launch refused (${native.symbols.GetLastError()})`)
}
const keep = (handle: number | bigint | null) => {
  check(handle !== null && BigInt(handle) !== 0n && BigInt(handle) !== 0xffffffffffffffffn)
  const value = BigInt(handle!)
  handles.push(value)
  return value
}
try {
  const jobName = wide(packet.job)
  const job = keep(native.symbols.OpenJobObjectW(4, false, ptr(jobName)))
  // A real handle avoids representing the -1 pseudo-handle as a JS pointer.
  const self = keep(native.symbols.OpenProcess(0x40, false, process.pid))
  const duplicate = (kind: number) => {
    const target = Buffer.alloc(8)
    check(native.symbols.DuplicateHandle(self, native.symbols.GetStdHandle(kind), self, ptr(target), 0, true, 2))
    return keep(target.readBigUInt64LE())
  }
  const output = duplicate(-11),
    error = duplicate(-12),
    security = Buffer.alloc(24)
  security.writeUInt32LE(security.length)
  security.writeUInt32LE(1, 16)
  const nul = wide('NUL')
  const input = keep(native.symbols.CreateFileW(ptr(nul), 0x80000000, 3, ptr(security), 3, 0x80, null))
  const startup = Buffer.alloc(104)
  startup.writeUInt32LE(startup.length)
  startup.writeUInt32LE(0x100, 60)
  startup.writeBigUInt64LE(input, 80)
  startup.writeBigUInt64LE(output, 88)
  startup.writeBigUInt64LE(error, 96)
  const executable = wide(packet.executable),
    command = wide(packet.command),
    cwd = wide(packet.cwd)
  check(
    native.symbols.CreateProcessW(
      ptr(executable),
      ptr(command),
      null,
      null,
      true,
      0x08000004,
      null,
      ptr(cwd),
      ptr(startup),
      ptr(child),
    ),
  )
  const processHandle = keep(child.readBigUInt64LE()),
    thread = keep(child.readBigUInt64LE(8)),
    member = Buffer.alloc(4)
  check(native.symbols.IsProcessInJob(processHandle, job, ptr(member)))
  check(member.readUInt32LE() === 1)
  native.symbols.CloseHandle(job)
  handles.splice(handles.indexOf(job), 1)
  check(native.symbols.ResumeThread(thread) !== 0xffffffff)
  resumed = true
  // Only the parent retains a job handle during target execution.
  check(native.symbols.WaitForSingleObject(processHandle, 0xffffffff) === 0)
  const code = Buffer.alloc(4)
  check(native.symbols.GetExitCodeProcess(processHandle, ptr(code)))
  exitCode = code.readUInt32LE()
} finally {
  if (!resumed && child.readBigUInt64LE()) native.symbols.TerminateProcess(child.readBigUInt64LE(), 125)
  for (const handle of handles.reverse()) native.symbols.CloseHandle(handle)
  native.close()
}
process.exit(exitCode)
export {}
