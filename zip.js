// ZIP "store" keeps the uploaded bytes intact. Original photos are already compressed.
const encoder = new TextEncoder();
const MAX32 = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function header(size, signature) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return {
    bytes,
    u16: (at, number) => view.setUint16(at, number, true),
    u32: (at, number) => view.setUint32(at, number, true),
    u64: (at, number) => view.setBigUint64(at, BigInt(number), true)
  };
}

async function checksum(blob) {
  let crc = 0xffffffff;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const byte of value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function makeZip(files) {
  const entries = [];
  const directory = [];
  const checksums = new WeakMap();
  const now = new Date();
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  let offset = 0;
  let directorySize = 0;
  for (const { path, blob } of files) {
    const name = encoder.encode(path);
    if (!checksums.has(blob)) checksums.set(blob,await checksum(blob));
    const crc = checksums.get(blob);
    const local = header(30, 0x04034b50);
    const bigFile = blob.size >= MAX32;
    const bigOffset = offset >= MAX32;
    const localExtra = zip64Extra(bigFile ? [blob.size, blob.size] : []);
    local.u16(4, bigFile ? 45 : 20);
    local.u16(6, 0x0800); // UTF-8 names
    local.u16(10, time);
    local.u16(12, date);
    local.u32(14, crc);
    local.u32(18, Math.min(blob.size, MAX32));
    local.u32(22, Math.min(blob.size, MAX32));
    local.u16(26, name.length);
    local.u16(28, localExtra.length);
    entries.push(local.bytes, name, localExtra, blob);

    const central = header(46, 0x02014b50);
    const extraFields = bigFile ? [blob.size, blob.size] : [];
    if (bigOffset) extraFields.push(offset);
    const centralExtra = zip64Extra(extraFields);
    central.u16(4, centralExtra.length ? 45 : 20);
    central.u16(6, centralExtra.length ? 45 : 20);
    central.u16(8, 0x0800);
    central.u16(12, time);
    central.u16(14, date);
    central.u32(16, crc);
    central.u32(20, Math.min(blob.size, MAX32));
    central.u32(24, Math.min(blob.size, MAX32));
    central.u16(28, name.length);
    central.u16(30, centralExtra.length);
    central.u32(42, Math.min(offset, MAX32));
    directory.push(central.bytes, name, centralExtra);
    directorySize += 46 + name.length + centralExtra.length;
    offset += 30 + name.length + localExtra.length + blob.size;
  }
  const tail = [];
  if (offset >= MAX32 || directorySize >= MAX32 || files.length >= 65535) {
    const record = header(56, 0x06064b50);
    record.u64(4, 44);
    record.u16(12, 45);
    record.u16(14, 45);
    record.u64(24, files.length);
    record.u64(32, files.length);
    record.u64(40, directorySize);
    record.u64(48, offset);
    const locator = header(20, 0x07064b50);
    locator.u64(8, offset + directorySize);
    locator.u32(16, 1);
    tail.push(record.bytes, locator.bytes);
  }
  const end = header(22, 0x06054b50);
  end.u16(8, Math.min(files.length, 65535));
  end.u16(10, Math.min(files.length, 65535));
  end.u32(12, Math.min(directorySize, MAX32));
  end.u32(16, Math.min(offset, MAX32));
  return new Blob([...entries, ...directory, ...tail, end.bytes], { type: 'application/zip' });
}

function zip64Extra(fields) {
  if (!fields.length) return new Uint8Array();
  const bytes = new Uint8Array(4 + 8 * fields.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, fields.length * 8, true);
  fields.forEach((field, i) => view.setBigUint64(4 + 8 * i, BigInt(field), true));
  return bytes;
}
