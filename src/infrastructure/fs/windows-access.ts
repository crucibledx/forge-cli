const DACL_INFORMATION = 0x00000004
const PROTECTED_DACL = 0x80000000
const UNPROTECTED_DACL = 0x20000000
const DACL_PRESENT = 0x0004
const DACL_PROTECTED = 0x1000
const wide = (path: string) => Buffer.from(`${path}\0`, 'utf16le')

/** Windows self-relative descriptors contain the DACL plus inheritance control. */
export function descriptorFlags(descriptor: Uint8Array) {
  const bytes = Buffer.from(descriptor)
  if (bytes.length < 20 || !(bytes.readUInt16LE(2) & 0x8000) || !(bytes.readUInt16LE(2) & DACL_PRESENT))
    throw new Error('Unsupported Windows access descriptor; refusing mutation')
  const offset = bytes.readUInt32LE(16)
  if (
    offset &&
    (offset < 20 ||
      offset + 8 > bytes.length ||
      bytes.readUInt16LE(offset + 2) < 8 ||
      offset + bytes.readUInt16LE(offset + 2) > bytes.length)
  )
    throw new Error('Invalid Windows DACL; refusing mutation')
  return {
    bytes,
    offset,
    flags: DACL_INFORMATION | (bytes.readUInt16LE(2) & DACL_PROTECTED ? PROTECTED_DACL : UNPROTECTED_DACL),
  }
}

export async function readAccessMetadata(path: string): Promise<Uint8Array | null> {
  if (process.platform !== 'win32') return null
  const {dlopen, ptr} = await import('bun:ffi')
  const security = dlopen('advapi32.dll', {
    GetFileSecurityW: {args: ['ptr', 'u32', 'ptr', 'u32', 'ptr'], returns: 'bool'},
    // Load restoration support during read-only preparation as well.
    SetNamedSecurityInfoW: {args: ['ptr', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'u32'},
  })
  const kernel = dlopen('kernel32.dll', {GetFileAttributesW: {args: ['ptr'], returns: 'u32'}})
  try {
    const name = wide(path),
      size = Buffer.alloc(4)
    const attributes = kernel.symbols.GetFileAttributesW(ptr(name))
    if (attributes === 0xffffffff || attributes & 1) throw new Error(`Read-only/inaccessible file: ${path}`)
    security.symbols.GetFileSecurityW(ptr(name), DACL_INFORMATION, null, 0, ptr(size))
    const length = size.readUInt32LE()
    if (length < 20 || length > 1024 * 1024) throw new Error(`Cannot snapshot Windows access controls: ${path}`)
    const descriptor = Buffer.alloc(length)
    if (!security.symbols.GetFileSecurityW(ptr(name), DACL_INFORMATION, ptr(descriptor), length, ptr(size)))
      throw new Error(`Cannot snapshot Windows access controls: ${path}`)
    descriptorFlags(descriptor)
    return descriptor
  } finally {
    security.close()
    kernel.close()
  }
}

export async function accessMetadataFromSddl(value: string): Promise<Uint8Array | null> {
  if (process.platform !== 'win32') return null
  const {dlopen, ptr, toArrayBuffer} = await import('bun:ffi')
  const security = dlopen('advapi32.dll', {
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {args: ['ptr', 'u32', 'ptr', 'ptr'], returns: 'bool'},
  })
  const kernel = dlopen('kernel32.dll', {LocalFree: {args: ['ptr'], returns: 'ptr'}})
  let allocated = 0
  try {
    const sddl = wide(value),
      pointer = Buffer.alloc(8),
      size = Buffer.alloc(4)
    if (!security.symbols.ConvertStringSecurityDescriptorToSecurityDescriptorW(ptr(sddl), 1, ptr(pointer), ptr(size)))
      throw new Error('Cannot create private Windows metadata access controls')
    allocated = Number(pointer.readBigUInt64LE())
    const length = size.readUInt32LE()
    if (!allocated || length < 20 || length > 1024 * 1024) throw new Error('Invalid private Windows descriptor')
    const descriptor = Buffer.from(new Uint8Array(toArrayBuffer(allocated, 0, length)))
    descriptorFlags(descriptor)
    return descriptor
  } finally {
    if (allocated) kernel.symbols.LocalFree(BigInt(allocated))
    security.close()
    kernel.close()
  }
}

/** New metadata is owner/SYSTEM-only instead of inheriting a broad project DACL. */
export const privateAccessMetadata = () => accessMetadataFromSddl('D:P(A;;FA;;;OW)(A;;FA;;;SY)')

async function temporaryAPI() {
  const {dlopen} = await import('bun:ffi')
  return dlopen('kernel32.dll', {
    CreateFileW: {args: ['ptr', 'u32', 'u32', 'ptr', 'u32', 'u32', 'ptr'], returns: 'u64'},
    WriteFile: {args: ['ptr', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'bool'},
    CloseHandle: {args: ['ptr'], returns: 'bool'},
  })
}

export interface TemporaryFile {
  writeFile(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
}

export async function checkPrivateTemporarySupport(): Promise<void> {
  if (process.platform !== 'win32') return
  await privateAccessMetadata()
  const native = await temporaryAPI()
  native.close()
}

/** CREATE_NEW installs a protected owner/SYSTEM DACL atomically, before any bytes exist. */
export async function openPrivateTemporary(path: string): Promise<TemporaryFile> {
  if (process.platform !== 'win32') throw new Error('Private Windows creation is unavailable on this OS')
  const descriptor = await privateAccessMetadata()
  if (!descriptor) throw new Error('Private Windows descriptor unavailable')
  const {ptr} = await import('bun:ffi')
  const native = await temporaryAPI()
  try {
    const name = wide(path),
      security = Buffer.alloc(24)
    security.writeUInt32LE(security.length)
    security.writeBigUInt64LE(BigInt(ptr(descriptor)), 8)
    const handle = BigInt(native.symbols.CreateFileW(ptr(name), 0x40000000, 7, ptr(security), 1, 0x80, null))
    if (handle === 0n || handle === -1n || handle === 0xffffffffffffffffn)
      throw new Error(`Private exclusive Windows creation refused: ${path}`)
    let closed = false
    return {
      async writeFile(bytes) {
        if (closed) throw new Error('Private temporary is closed')
        for (let offset = 0; offset < bytes.length;) {
          const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 1024 * 1024))
          const written = Buffer.alloc(4)
          if (!native.symbols.WriteFile(handle, ptr(chunk), chunk.length, ptr(written), null))
            throw new Error(`Private Windows write failed: ${path}`)
          const count = written.readUInt32LE()
          if (!count || count > chunk.length) throw new Error(`Invalid private Windows write count: ${path}`)
          offset += count
        }
      },
      async close() {
        if (closed) return
        closed = true
        const success = native.symbols.CloseHandle(handle)
        native.close()
        if (!success) throw new Error(`Private Windows close failed: ${path}`)
      },
    }
  } catch (error) {
    native.close()
    throw error
  }
}

export async function writeAccessMetadata(path: string, descriptor: Uint8Array): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Windows descriptor cannot be applied on another OS')
  const {dlopen, ptr} = await import('bun:ffi')
  const security = dlopen('advapi32.dll', {
    SetNamedSecurityInfoW: {args: ['ptr', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'u32'},
  })
  try {
    const {bytes, offset, flags} = descriptorFlags(descriptor),
      name = wide(path)
    const result = security.symbols.SetNamedSecurityInfoW(
      ptr(name),
      1,
      flags >>> 0,
      null,
      null,
      offset ? ptr(bytes) + offset : null,
      null,
    )
    if (result !== 0) throw new Error(`Access-preserving Windows restoration refused: ${path}`)
  } finally {
    security.close()
  }
}
