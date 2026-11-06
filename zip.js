// ZIP "store" keeps the uploaded bytes intact. Original photos are already compressed.
const encoder = new TextEncoder();
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
    u32: (at, number) => view.setUint32(at, number, true)
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
  const now = new Date();
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  let offset = 0;
  let directorySize = 0;
  for (const { path, blob } of files) {
    const name = encoder.encode(path);
    const crc = await checksum(blob);
    const local = header(30, 0x04034b50);
    local.u16(4, 20);
    local.u16(6, 0x0800); // UTF-8 names
    local.u16(10, time);
    local.u16(12, date);
    local.u32(14, crc);
    local.u32(18, blob.size);
    local.u32(22, blob.size);
    local.u16(26, name.length);
    entries.push(local.bytes, name, blob);

    const central = header(46, 0x02014b50);
    central.u16(4, 20);
    central.u16(6, 20);
    central.u16(8, 0x0800);
    central.u16(12, time);
    central.u16(14, date);
    central.u32(16, crc);
    central.u32(20, blob.size);
    central.u32(24, blob.size);
    central.u16(28, name.length);
    central.u32(42, offset);
    directory.push(central.bytes, name);
    directorySize += 46 + name.length;
    offset += 30 + name.length + blob.size;
  }
  const end = header(22, 0x06054b50);
  end.u16(8, files.length);
  end.u16(10, files.length);
  end.u32(12, directorySize);
  end.u32(16, offset);
  return new Blob([...entries, ...directory, end.bytes], { type: 'application/zip' });
}
