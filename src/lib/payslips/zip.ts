// A minimal, dependency-free ZIP writer — "stored" entries only (no compression).
//
// WHY WRITE ONE. "Allow for multiple downloads at once as a zip" (owner, 2026-10-14). A payslip is already
// a compressed PDF or JPEG, so deflating it again buys nothing, and a stored-only writer is ~100 lines that can
// be proved correct against an independent reader (the harness unzips with the operating system's own `tar`)
// instead of one more dependency in a payroll path. It STREAMS: each entry's bytes are produced one at a time,
// written, and dropped, so a 150-file archive never sits in memory whole.
//
// Because every entry is fully in hand before its header is written, the CRC and sizes go straight into the
// LOCAL header — no "data descriptor" trailer, which is the part strict streaming readers (and some phones'
// built-in unzippers) get wrong.
//
// File names are written as UTF-8 and flagged as such (general-purpose bit 11), so a Hebrew name survives
// Windows Explorer, macOS Archive Utility and `tar` alike.
//
// NOT supported, deliberately: ZIP64 (more than 65,534 entries, or any offset/size past 4 GiB — the callers cap
// well below that and this refuses rather than writing an archive that lies), encryption, compression.

export interface ZipEntry {
  /** Path inside the archive, `/`-separated. Never absolute, never containing `..`. */
  name: string
  data: Uint8Array
  /** Shown as the file's modified time. Defaults to now. */
  mtime?: Date
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50
const FLAG_UTF8 = 0x0800
const VERSION = 20
const MAX_ENTRIES = 0xfffe
const MAX_32 = 0xffffffff

// ── CRC-32 (IEEE 802.3), the one every ZIP reader checks ────────────────────
let TABLE: Uint32Array | null = null
function table(): Uint32Array {
  if (TABLE) return TABLE
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  TABLE = t
  return t
}

export function crc32(bytes: Uint8Array): number {
  const t = table()
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, the only clock a ZIP entry has. Two-second resolution; 1980–2107. */
export function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getFullYear()))
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** Refuses a name that could climb out of the folder it is extracted into ("zip-slip"). */
export function isSafeZipName(name: string): boolean {
  if (!name || name.length > 255) return false
  if (name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false
  return !name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
}

const enc = new TextEncoder()

function localHeader(nameBytes: Uint8Array, crc: number, size: number, d: { time: number; date: number }): Uint8Array {
  const out = new Uint8Array(30 + nameBytes.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, SIG_LOCAL, true)
  v.setUint16(4, VERSION, true)
  v.setUint16(6, FLAG_UTF8, true)
  v.setUint16(8, 0, true)            // method 0 = stored
  v.setUint16(10, d.time, true)
  v.setUint16(12, d.date, true)
  v.setUint32(14, crc, true)
  v.setUint32(18, size, true)        // compressed size = size (stored)
  v.setUint32(22, size, true)
  v.setUint16(26, nameBytes.length, true)
  v.setUint16(28, 0, true)           // no extra field
  out.set(nameBytes, 30)
  return out
}

interface Done { nameBytes: Uint8Array; crc: number; size: number; offset: number; d: { time: number; date: number } }

function centralHeader(e: Done): Uint8Array {
  const out = new Uint8Array(46 + e.nameBytes.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, SIG_CENTRAL, true)
  v.setUint16(4, VERSION, true)      // made by (MS-DOS, 2.0)
  v.setUint16(6, VERSION, true)      // needed to extract
  v.setUint16(8, FLAG_UTF8, true)
  v.setUint16(10, 0, true)
  v.setUint16(12, e.d.time, true)
  v.setUint16(14, e.d.date, true)
  v.setUint32(16, e.crc, true)
  v.setUint32(20, e.size, true)
  v.setUint32(24, e.size, true)
  v.setUint16(28, e.nameBytes.length, true)
  v.setUint16(30, 0, true)           // extra
  v.setUint16(32, 0, true)           // comment
  v.setUint16(34, 0, true)           // disk number
  v.setUint16(36, 0, true)           // internal attributes
  v.setUint32(38, 0, true)           // external attributes
  v.setUint32(42, e.offset, true)
  out.set(e.nameBytes, 46)
  return out
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const out = new Uint8Array(22)
  const v = new DataView(out.buffer)
  v.setUint32(0, SIG_END, true)
  v.setUint16(4, 0, true)
  v.setUint16(6, 0, true)
  v.setUint16(8, count, true)
  v.setUint16(10, count, true)
  v.setUint32(12, cdSize, true)
  v.setUint32(16, cdOffset, true)
  v.setUint16(20, 0, true)
  return out
}

/** The archive as a sequence of chunks, produced lazily: `entries` is pulled one item at a time. */
export async function* zipChunks(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): AsyncGenerator<Uint8Array> {
  const done: Done[] = []
  let offset = 0
  for await (const entry of entries as AsyncIterable<ZipEntry>) {
    if (!isSafeZipName(entry.name)) throw new Error(`zip: unsafe entry name ${JSON.stringify(entry.name)}`)
    if (done.length >= MAX_ENTRIES) throw new Error('zip: too many entries')
    const size = entry.data.length
    if (size > MAX_32 || offset + size + 30 + 512 > MAX_32) throw new Error('zip: archive too large (no ZIP64)')
    const nameBytes = enc.encode(entry.name)
    const d = dosDateTime(entry.mtime ?? new Date())
    const crc = crc32(entry.data)
    const head = localHeader(nameBytes, crc, size, d)
    done.push({ nameBytes, crc, size, offset, d })
    offset += head.length + size
    yield head
    if (size) yield entry.data
  }
  const cdOffset = offset
  let cdSize = 0
  for (const e of done) {
    const c = centralHeader(e)
    cdSize += c.length
    yield c
  }
  yield endRecord(done.length, cdSize, cdOffset)
}

/** The same archive as a web stream (pull-based: the next entry is only produced when the client has read). */
export function zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): ReadableStream<Uint8Array> {
  const it = zipChunks(entries)[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) {
        controller.error(err)
      }
    },
    async cancel() {
      await it.return?.(undefined)
    },
  })
}

/** The whole archive in memory. For tests and tiny archives only. */
export async function zipBytes(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let total = 0
  for await (const c of zipChunks(entries)) { parts.push(c); total += c.length }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
