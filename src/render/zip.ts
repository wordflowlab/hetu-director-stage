/** 无压缩ZIP，保留UTF-8文件名；仅打包本次渲染的有限字节。 */
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[i] = c;
}
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function zip(files: { name: string; bytes: Uint8Array }[]) {
  let offset = 0;
  const locals: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  for (const f of files) {
    if (
      !f.name ||
      /[\\\u0000]/.test(f.name) ||
      f.name.split("/").some((x) => x === ".." || x === "")
    )
      throw new Error("归档文件名无效。");
    const name = new TextEncoder().encode(f.name),
      header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc(f.bytes), true);
    v.setUint32(18, f.bytes.length, true);
    v.setUint32(22, f.bytes.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    locals.push(header, f.bytes);
    const central = new Uint8Array(46 + name.length),
      d = new DataView(central.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint32(16, crc(f.bytes), true);
    d.setUint32(20, f.bytes.length, true);
    d.setUint32(24, f.bytes.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);
    offset += header.length + f.bytes.length;
  }
  const size = directory.reduce((s, b) => s + b.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, files.length, true);
  v.setUint16(10, files.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  const result = new Uint8Array(offset + size + 22);
  let p = 0;
  for (const bytes of [...locals, ...directory, end]) {
    result.set(bytes, p);
    p += bytes.length;
  }
  return result;
}
