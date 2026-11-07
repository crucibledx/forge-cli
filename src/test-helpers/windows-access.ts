/** Native fixture construction only; production metadata never accepts arbitrary SDDL. */
export async function accessMetadataFromSddl(value: string): Promise<Uint8Array> {
  const {dlopen, ptr, toArrayBuffer} = await import('bun:ffi')
  const security = dlopen('advapi32.dll', {
    ConvertStringSecurityDescriptorToSecurityDescriptorW: {args: ['ptr', 'u32', 'ptr', 'ptr'], returns: 'bool'},
  })
  const kernel = dlopen('kernel32.dll', {LocalFree: {args: ['ptr'], returns: 'ptr'}})
  let allocated = 0
  try {
    const sddl = Buffer.from(`${value}\0`, 'utf16le'),
      pointer = Buffer.alloc(8),
      size = Buffer.alloc(4)
    if (!security.symbols.ConvertStringSecurityDescriptorToSecurityDescriptorW(ptr(sddl), 1, ptr(pointer), ptr(size)))
      throw new Error('Cannot construct Windows access fixture')
    allocated = Number(pointer.readBigUInt64LE())
    const length = size.readUInt32LE()
    if (!allocated || length < 20 || length > 1024 * 1024) throw new Error('Invalid Windows access fixture')
    return Buffer.from(new Uint8Array(toArrayBuffer(allocated, 0, length)))
  } finally {
    if (allocated) kernel.symbols.LocalFree(BigInt(allocated))
    security.close()
    kernel.close()
  }
}
