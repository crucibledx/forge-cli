import {windowsArgument} from '../../owned-pipe'

/** Avoid Bun's own child-handle cleanup concealing a leader-exits-first defect. */
export async function nativeWindowsChild(): Promise<number> {
  const {dlopen, ptr} = await import('bun:ffi')
  const native = dlopen('kernel32.dll', {
    CreateProcessW: {args: ['ptr', 'ptr', 'ptr', 'ptr', 'bool', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'bool'},
    CloseHandle: {args: ['ptr'], returns: 'bool'},
  })
  try {
    const program = Buffer.from(`${process.execPath}\0`, 'utf16le')
    const command = Buffer.from(
      [process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"].map(windowsArgument).join(' ') +
        '\0',
      'utf16le',
    )
    const startup = Buffer.alloc(104),
      information = Buffer.alloc(24)
    startup.writeUInt32LE(startup.length)
    if (
      !native.symbols.CreateProcessW(
        ptr(program),
        ptr(command),
        null,
        null,
        false,
        0x08000000,
        null,
        null,
        ptr(startup),
        ptr(information),
      )
    )
      throw new Error('Cannot create native descendant fixture')
    native.symbols.CloseHandle(information.readBigUInt64LE())
    native.symbols.CloseHandle(information.readBigUInt64LE(8))
    return information.readUInt32LE(16)
  } finally {
    native.close()
  }
}
