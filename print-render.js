// Crop coordinates are fractions of the EXIF-oriented original. Layout rectangles
// for the aperture and destination are fractions of the finished sheet.
const full = () => ({x: 0, y: 0, width: 1, height: 1});
const paperColors = {
  none: '#ffffff',
  white: '#ffffff',
  polaroid: '#ffffff',
  'polaroid-black': '#252422',
  'polaroid-cream': '#f5ead5'
};

function optionStyle(list, id) {
  return list.find(option => option.id === id)?.preview || id;
}

function outputSize(asset, format) {
  const long = Math.max(format.width, format.height);
  const short = Math.min(format.width, format.height);
  const longPixels = Math.round(long * 300 / 2.54);
  const shortPixels = Math.round(short * 300 / 2.54);
  const scale = Math.min(1, 6000 / longPixels);
  const large = Math.max(1, Math.round(longPixels * scale));
  const small = Math.max(1, Math.round(shortPixels * scale));
  return asset.width >= asset.height
    ? {width: large, height: small}
    : {width: small, height: large};
}

function frameAperture(style, width, height) {
  if (!Object.hasOwn(paperColors, style) || style === 'none') return full();
  const side = style === 'white' ? 0.04 : 0.06;
  const bottom = style === 'white' ? side : 0.19;
  const shorter = Math.min(width, height);
  const x = side * shorter / width;
  const y = side * shorter / height;
  return {x, y, width: 1 - 2 * x, height: 1 - y - bottom * shorter / height};
}

function cropWindow(crop) {
  if (crop == null) return full();
  const {x, y, width, height} = crop;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 ||
      width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) {
    throw Error('Границы кадра выходят за пределы фотографии.');
  }
  return {x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y)};
}

// Center a smaller box of the requested aspect inside rect, without stretching.
function centerFit(rect, currentAspect, targetAspect) {
  const result = {...rect};
  if (currentAspect > targetAspect) {
    result.width *= targetAspect / currentAspect;
    result.x += (rect.width - result.width) / 2;
  } else {
    result.height *= currentAspect / targetAspect;
    result.y += (rect.height - result.height) / 2;
  }
  return result;
}

export function layoutPrint(photo, format, catalog) {
  const asset = photo.asset;
  const {width, height} = outputSize(asset, format);
  const style = optionStyle(catalog.frames, photo.frameId);
  const aperture = frameAperture(style, width, height);
  let source = cropWindow(photo.crop);
  let destination = {...aperture};
  const imageAspect = asset.width * source.width / (asset.height * source.height);
  const targetAspect = aperture.width * width / (aperture.height * height);
  if (optionStyle(catalog.fits, photo.fitId) === 'contain') {
    destination = centerFit(aperture, targetAspect, imageAspect);
  } else {
    source = centerFit(source, imageAspect, targetAspect);
  }
  return {width, height, aperture, background: paperColors[style] || '#ffffff', source, destination};
}

async function jpegWithPrintDensity(blob, density) {
  // Canvas encoders default to screen DPI. Write the actual physical print density
  // into the JPEG without re-encoding pixels or copying its full payload.
  const prefix = new Uint8Array(await blob.slice(0, 20).arrayBuffer());
  if (prefix[0] !== 0xff || prefix[1] !== 0xd8) throw Error('Не удалось сохранить изображение в JPEG.');
  const jfif = Uint8Array.of(0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1,
    density >> 8, density & 255, density >> 8, density & 255, 0, 0);
  const hasJfif = prefix[2] === 0xff && prefix[3] === 0xe0 &&
    String.fromCharCode(...prefix.slice(6, 11)) === 'JFIF\0';
  if (hasJfif) {
    const pixelsPerInch = jfif.slice(11, 16);
    return new Blob([blob.slice(0, 13), pixelsPerInch, blob.slice(18)], {type: 'image/jpeg'});
  }
  return new Blob([blob.slice(0, 2), jfif, blob.slice(2)], {type: 'image/jpeg'});
}

export async function renderPrint(photo, format, catalog) {
  const layout = layoutPrint(photo, format, catalog);
  const image = new Image();
  image.src = photo.asset.url;
  await image.decode();
  const canvas = document.createElement('canvas');
  try {
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) throw Error('Браузер не смог подготовить отпечаток.');
    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    const src = layout.source;
    const dest = layout.destination;
    ctx.drawImage(image,
      src.x * image.naturalWidth, src.y * image.naturalHeight,
      src.width * image.naturalWidth, src.height * image.naturalHeight,
      dest.x * canvas.width, dest.y * canvas.height,
      dest.width * canvas.width, dest.height * canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (!blob) throw Error('Браузеру не хватило памяти для подготовки отпечатка.');
    const density = Math.round(Math.min(300, 6000 * 2.54 / Math.max(format.width, format.height)));
    return await jpegWithPrintDensity(blob, density);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
