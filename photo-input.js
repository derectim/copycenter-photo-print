const maxFileBytes = 20 * 1024 * 1024;
const maxPixels = 80_000_000;
const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const ascii = (bytes, start, count) => String.fromCharCode(...bytes.subarray(start, start + count));

function imageType(bytes, name) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brands = [ascii(bytes, 8, 4)];
    for (let i = 16; i + 4 <= Math.min(size, bytes.length); i += 4) brands.push(ascii(bytes, i, 4));
    if (brands.some(brand => heifBrands.has(brand)) && !brands.some(brand => ['avif','avis'].includes(brand))) {
      return /\.heif$/i.test(name) ? 'heif' : 'heic';
    }
  }
  throw Error('поддерживаются JPG, PNG, WebP и фотографии iPhone в HEIC или HEIF');
}

function checkPixels(width, height) {
  if (!width || !height) throw Error('не удалось определить размер снимка');
  if (width * height > maxPixels) throw Error('разрешение превышает 80 Мп');
}

// Check spatial extents in ISO BMFF metadata before a decoder allocates image buffers.
// Skip media payloads and walk only the known containers for HEIF image properties.
function checkHeifDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function visit(start, end, level) {
    const levels = ['meta', 'iprp', 'ipco', 'ispe'];
    while (start + 8 <= end) {
      let size = view.getUint32(start);
      let header = 8;
      if (size === 1) {
        if (start + 16 > end || view.getUint32(start + 8) !== 0) throw Error('повреждена структура HEIC');
        size = view.getUint32(start + 12);
        header = 16;
      } else if (!size) size = end - start;
      if (size < header || size > end - start) throw Error('повреждена структура HEIC');
      if (ascii(bytes, start + 4, 4) === levels[level]) {
        const payload = start + header;
        if (level === 3) {
          if (size < header + 12) throw Error('повреждены размеры HEIC');
          checkPixels(view.getUint32(payload + 4), view.getUint32(payload + 8));
        } else visit(payload + (level === 0 ? 4 : 0), start + size, level + 1);
      }
      start += size;
    }
  }
  visit(0, bytes.length, 0);
}

async function decodedAsset(file, source, extension) {
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    checkPixels(image.naturalWidth, image.naturalHeight);
    return {file, url, extension, width: image.naturalWidth, height: image.naturalHeight};
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function readPrintAsset(file) {
  if (!file.size || file.size > maxFileBytes) throw Error('нужен файл размером от 1 байта до 20 МБ');
  const prefix = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const extension = imageType(prefix, file.name);
  const heif = extension === 'heic' || extension === 'heif';
  if (heif) checkHeifDimensions(new Uint8Array(await file.arrayBuffer()));
  try {
    return await decodedAsset(file, file, extension);
  } catch (error) {
    if (!heif) {
      if (error.message.includes('80 Мп')) throw error;
      throw Error('не удалось прочитать изображение');
    }
  }
  try {
    const {heicTo} = await import('./vendor/heic-to/heic-to.js');
    // The decoder selects the primary still in a HEIF collection. Keep the original
    // for the order and use the converted image only as the editing/rendering source.
    const jpeg = await heicTo({blob: file, type: 'image/jpeg', quality: 0.98});
    return await decodedAsset(file, jpeg, extension);
  } catch (error) {
    if (error?.message?.includes('80 Мп')) throw error;
    throw Error('не удалось прочитать HEIC/HEIF; попробуйте экспортировать снимок как JPEG');
  }
}
