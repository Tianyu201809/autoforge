import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs'

export type ExecutableFormat = 'pe' | 'mach-o' | 'elf'
export type ExecutablePlatform = 'win32' | 'darwin' | 'linux'

export interface ExecutableInspection {
  format: ExecutableFormat
  platform: ExecutablePlatform
  kind: 'executable' | 'library'
  architectures: string[]
}

const MAX_HEADER_BYTES = 64 * 1024
const IMAGE_FILE_DLL = 0x2000
const PT_INTERP = 3
const MH_EXECUTE = 2
const MH_DYLIB = 6

function readAt(fd: number, position: number, length: number): Buffer {
  if (!Number.isSafeInteger(position) || position < 0 || length <= 0) return Buffer.alloc(0)
  const buffer = Buffer.alloc(length)
  const bytesRead = readSync(fd, buffer, 0, length, position)
  return buffer.subarray(0, bytesRead)
}

function peArchitecture(machine: number): string {
  if (machine === 0x014c) return 'x86'
  if (machine === 0x8664) return 'x64'
  if (machine === 0xaa64) return 'arm64'
  if (machine === 0x01c4) return 'arm'
  return `machine-0x${machine.toString(16)}`
}

function inspectPe(buffer: Buffer): ExecutableInspection | null {
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset > buffer.length - 24) return null
  if (buffer.toString('binary', peOffset, peOffset + 4) !== 'PE\0\0') return null
  const machine = buffer.readUInt16LE(peOffset + 4)
  const characteristics = buffer.readUInt16LE(peOffset + 22)
  return {
    format: 'pe',
    platform: 'win32',
    kind: characteristics & IMAGE_FILE_DLL ? 'library' : 'executable',
    architectures: [peArchitecture(machine)]
  }
}

function elfArchitecture(machine: number): string {
  if (machine === 3) return 'x86'
  if (machine === 40) return 'arm'
  if (machine === 62) return 'x64'
  if (machine === 183) return 'arm64'
  return `machine-${machine}`
}

function inspectElf(buffer: Buffer): ExecutableInspection | null {
  if (
    buffer.length < 52 ||
    buffer[0] !== 0x7f ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x4c ||
    buffer[3] !== 0x46
  ) return null

  const elfClass = buffer[4]
  const data = buffer[5]
  if ((elfClass !== 1 && elfClass !== 2) || (data !== 1 && data !== 2)) return null
  const littleEndian = data === 1
  const read16 = (offset: number): number => littleEndian
    ? buffer.readUInt16LE(offset)
    : buffer.readUInt16BE(offset)
  const read32 = (offset: number): number => littleEndian
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset)
  const readOffset = (offset: number): number => {
    if (elfClass === 1) return read32(offset)
    const value = littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset)
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : -1
  }

  const type = read16(16)
  if (type !== 2 && type !== 3) return null
  const machine = read16(18)
  let hasInterpreter = false
  if (type === 3) {
    const programOffset = readOffset(elfClass === 1 ? 28 : 32)
    const entrySize = read16(elfClass === 1 ? 42 : 54)
    const entryCount = read16(elfClass === 1 ? 44 : 56)
    if (programOffset >= 0 && entrySize >= 4 && entryCount <= 4096) {
      for (let index = 0; index < entryCount; index += 1) {
        const offset = programOffset + index * entrySize
        if (offset < 0 || offset > buffer.length - 4) break
        if (read32(offset) === PT_INTERP) {
          hasInterpreter = true
          break
        }
      }
    }
  }

  return {
    format: 'elf',
    platform: 'linux',
    kind: type === 2 || hasInterpreter ? 'executable' : 'library',
    architectures: [elfArchitecture(machine)]
  }
}

interface MachOMagic {
  endian: 'le' | 'be'
  bits: 32 | 64
}

function machOMagic(buffer: Buffer): MachOMagic | null {
  if (buffer.length < 4) return null
  const magic = buffer.readUInt32BE(0)
  if (magic === 0xfeedface) return { endian: 'be', bits: 32 }
  if (magic === 0xfeedfacf) return { endian: 'be', bits: 64 }
  if (magic === 0xcefaedfe) return { endian: 'le', bits: 32 }
  if (magic === 0xcffaedfe) return { endian: 'le', bits: 64 }
  return null
}

function machArchitecture(cpuType: number): string {
  const normalized = cpuType >>> 0
  if (normalized === 7) return 'x86'
  if (normalized === 0x01000007) return 'x64'
  if (normalized === 12) return 'arm'
  if (normalized === 0x0100000c) return 'arm64'
  return `cpu-0x${normalized.toString(16)}`
}

function inspectThinMachO(buffer: Buffer): ExecutableInspection | null {
  const magic = machOMagic(buffer)
  if (!magic || buffer.length < (magic.bits === 64 ? 32 : 28)) return null
  const read32 = magic.endian === 'le'
    ? (offset: number): number => buffer.readUInt32LE(offset)
    : (offset: number): number => buffer.readUInt32BE(offset)
  const cpuType = read32(4)
  const fileType = read32(12)
  if (fileType !== MH_EXECUTE && fileType !== MH_DYLIB) return null
  return {
    format: 'mach-o',
    platform: 'darwin',
    kind: fileType === MH_EXECUTE ? 'executable' : 'library',
    architectures: [machArchitecture(cpuType)]
  }
}

function inspectFatMachO(fd: number, buffer: Buffer, fileSize: number): ExecutableInspection | null {
  if (buffer.length < 8) return null
  const magic = buffer.readUInt32BE(0)
  const is64 = magic === 0xcafebabf || magic === 0xbfbafeca
  const littleEndian = magic === 0xbebafeca || magic === 0xbfbafeca
  if (
    magic !== 0xcafebabe &&
    magic !== 0xcafebabf &&
    magic !== 0xbebafeca &&
    magic !== 0xbfbafeca
  ) return null
  const read32 = littleEndian
    ? (offset: number): number => buffer.readUInt32LE(offset)
    : (offset: number): number => buffer.readUInt32BE(offset)
  const entrySize = is64 ? 32 : 20
  const count = read32(4)
  if (count < 1 || count > 64 || 8 + count * entrySize > buffer.length) return null

  const architectures: string[] = []
  let hasExecutable = false
  let hasLibrary = false
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 8 + index * entrySize
    architectures.push(machArchitecture(read32(entryOffset)))
    let sliceOffset: number
    let sliceSize: number
    if (is64) {
      const rawOffset = littleEndian
        ? buffer.readBigUInt64LE(entryOffset + 8)
        : buffer.readBigUInt64BE(entryOffset + 8)
      const rawSize = littleEndian
        ? buffer.readBigUInt64LE(entryOffset + 16)
        : buffer.readBigUInt64BE(entryOffset + 16)
      if (rawOffset > BigInt(Number.MAX_SAFE_INTEGER) || rawSize > BigInt(Number.MAX_SAFE_INTEGER)) continue
      sliceOffset = Number(rawOffset)
      sliceSize = Number(rawSize)
    } else {
      sliceOffset = read32(entryOffset + 8)
      sliceSize = read32(entryOffset + 12)
    }
    if (sliceOffset < 0 || sliceSize <= 0 || sliceOffset + sliceSize > fileSize) continue
    const inspection = inspectThinMachO(readAt(fd, sliceOffset, Math.min(sliceSize, MAX_HEADER_BYTES)))
    if (inspection?.kind === 'executable') hasExecutable = true
    if (inspection?.kind === 'library') hasLibrary = true
  }
  if (!hasExecutable && !hasLibrary) return null
  return {
    format: 'mach-o',
    platform: 'darwin',
    kind: hasExecutable ? 'executable' : 'library',
    architectures: [...new Set(architectures)]
  }
}

export function inspectExecutable(filePath: string): ExecutableInspection | null {
  let pathStat
  try {
    pathStat = lstatSync(filePath)
  } catch {
    return null
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) return null

  const fd = openSync(filePath, 'r')
  try {
    const stat = fstatSync(fd)
    const header = readAt(fd, 0, Math.min(stat.size, MAX_HEADER_BYTES))
    return (
      inspectPe(header) ??
      inspectElf(header) ??
      inspectThinMachO(header) ??
      inspectFatMachO(fd, header, stat.size)
    )
  } finally {
    closeSync(fd)
  }
}

export function assertRunnableExecutable(
  filePath: string,
  platform: NodeJS.Platform = process.platform
): ExecutableInspection {
  const inspection = inspectExecutable(filePath)
  if (!inspection || inspection.kind !== 'executable') {
    throw new Error('入口不是有效的 PE、Mach-O 或 ELF 可执行程序')
  }
  if (inspection.platform !== platform) {
    throw new Error(`入口目标平台为 ${inspection.platform}，当前平台为 ${platform}`)
  }
  return inspection
}
