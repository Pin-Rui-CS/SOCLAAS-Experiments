/**
 * A minimal ZIP writer: stored (uncompressed) entries, UTF-8 names, one pass.
 *
 * Enough for bundling one question's files, which total well under a megabyte
 * — compression would save little, and `trace.tar.gz` is already compressed.
 * Written out rather than pulling in a dependency for ~80 lines of format.
 * Layout per APPNOTE 6.3: local headers + data, then the central directory,
 * then the end-of-central-directory record. No ZIP64, so under 4GB only.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, the only timestamp the basic headers carry. */
function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function zip(entries: { name: string; data: Uint8Array }[], when = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // local file header signature
    l.setUint16(4, 20, true); // version needed: 2.0
    l.setUint16(6, 0x0800, true); // flags: names are UTF-8
    l.setUint16(8, 0, true); // method: stored
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, size, true); // compressed size
    l.setUint32(22, size, true); // uncompressed size
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true); // extra field length
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); // central directory header signature
    c.setUint16(4, 20, true); // version made by
    c.setUint16(6, 20, true); // version needed
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, size, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    // extra, comment, disk start, internal attrs, external attrs: all zero
    c.setUint32(42, offset, true); // where this entry's local header starts
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); // end of central directory signature
  e.setUint16(8, entries.length, true); // entries on this disk
  e.setUint16(10, entries.length, true); // entries total
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true); // central directory offset

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
