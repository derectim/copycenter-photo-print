import { colorGrade, gradePixels } from './photo-color.js';

// Crop bounds refer to the transformed, EXIF-oriented original; the same
// coordinates are used by the drag handles, proof, downloadable JPEG and draft.
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

export function transformedSize(asset, edits = {}) {
  const radians = (edits?.angle || 0) * Math.PI / 180;
  const cos = Math.round(Math.cos(radians) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(radians) * 1e12) / 1e12;
  return {
    width: Math.abs(cos) * asset.width + Math.abs(sin) * asset.height,
    height: Math.abs(sin) * asset.width + Math.abs(cos) * asset.height,
    radians
  };
}

function outputSize(view, format, orientation) {
  const long = Math.max(format.width, format.height);
  const short = Math.min(format.width, format.height);
  const longPixels = Math.round(long * 300 / 2.54);
  const shortPixels = Math.round(short * 300 / 2.54);
  const scale = Math.min(1, 6000 / longPixels);
  const large = Math.max(1, Math.round(longPixels * scale));
  const small = Math.max(1, Math.round(shortPixels * scale));
  const landscape = orientation === 'landscape' || (orientation !== 'portrait' && view.width >= view.height);
  return landscape
    ? {width: large, height: small}
    : {width: small, height: large};
}

export function frameMargins(photo, format, catalog) {
  const style = optionStyle(catalog.frames, photo.frameId);
  const {width, height} = sheetMillimeters(photo, format);
  if (!Object.hasOwn(paperColors, style) || style === 'none') return {left:0,right:0,top:0,bottom:0};
  const side = style === 'white' ? 0.04 : 0.06;
  const bottom = style === 'white' ? side : 0.19;
  const shorter = Math.min(width, height);
  const margins = {left:side * shorter, right:side * shorter, top:side * shorter, bottom:bottom * shorter};
  for (const key of Object.keys(margins)) {
    if (Number.isFinite(photo.edits?.frame?.[key])) margins[key] = Math.max(0, photo.edits.frame[key]);
  }
  // A format can be changed after a frame is authored. Keep at least 1 mm of photograph.
  for (const [a,b,sideMm] of [['left','right',width],['top','bottom',height]]) {
    const scale = Math.min(1, Math.max(0, sideMm - 1) / (margins[a] + margins[b] || 1));
    margins[a] *= scale;
    margins[b] *= scale;
  }
  return margins;
}

export function sheetMillimeters(photo, format) {
  const view = transformedSize(photo.asset, photo.edits);
  const size = outputSize(view, format, photo.edits?.orientation);
  const small = 10 * Math.min(format.width, format.height);
  const large = 10 * Math.max(format.width, format.height);
  return size.width >= size.height ? {width:large,height:small} : {width:small,height:large};
}

// A draft may move to a smaller format or switch orientation after borders were set.
// Snapshot the effective explicit edges so the work order describes the actual JPEG.
export function constrainFrameEdits(photo, format, catalog) {
  if (!photo.edits?.frame) return;
  const frame = {...photo.edits.frame};
  const style = optionStyle(catalog.frames, photo.frameId);
  photo.edits = {...photo.edits};
  if (style === 'none') {
    delete photo.edits.frame;
    return;
  }
  const margins = frameMargins(photo, format, catalog);
  for (const key of Object.keys(margins)) {
    if (Object.hasOwn(frame,key)) frame[key] = Math.round(margins[key] * 1e6) / 1e6;
  }
  photo.edits.frame = frame;
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
  const view = transformedSize(asset, photo.edits);
  const {width, height} = outputSize(view, format, photo.edits?.orientation);
  const style = optionStyle(catalog.frames, photo.frameId);
  const mm = sheetMillimeters(photo, format);
  const margins = frameMargins(photo, format, catalog);
  const aperture = {x: margins.left/mm.width, y: margins.top/mm.height,
    width: 1 - (margins.left + margins.right)/mm.width, height: 1 - (margins.top + margins.bottom)/mm.height};
  let source = cropWindow(photo.crop);
  let destination = {...aperture};
  const imageAspect = view.width * source.width / (view.height * source.height);
  const targetAspect = aperture.width * width / (aperture.height * height);
  if (optionStyle(catalog.fits, photo.fitId) === 'contain') {
    destination = centerFit(aperture, targetAspect, imageAspect);
  } else {
    source = centerFit(source, imageAspect, targetAspect);
  }
  const background = style !== 'none' && /^#[0-9a-f]{6}$/i.test(photo.edits?.frame?.color)
    ? photo.edits.frame.color : paperColors[style] || '#ffffff';
  return {width, height, aperture, background, source, destination, view, mm};
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

const recentImages = new Map();
function decodedImage(url) {
  let promise = recentImages.get(url);
  if (!promise) {
    const image = new Image();
    image.src = url;
    promise = image.decode().then(() => image).catch(() => {
      recentImages.delete(url);
      throw Error('Не удалось прочитать снимок для печати.');
    });
  }
  recentImages.delete(url);
  recentImages.set(url, promise);
  if (recentImages.size > 3) recentImages.delete(recentImages.keys().next().value);
  return promise;
}

export function effectiveDpi(layout) {
  const x = layout.view.width * layout.source.width / (layout.destination.width * layout.mm.width / 25.4);
  const y = layout.view.height * layout.source.height / (layout.destination.height * layout.mm.height / 25.4);
  return Math.round(Math.min(x, y));
}

export async function paintPrint(canvas, photo, format, catalog, options = {}) {
  const layout = layoutPrint(photo, format, catalog);
  const image = await decodedImage(photo.asset.url);
  const valid = options.valid || (() => true);
  if (!valid()) return;
  const {view} = layout;
  const sourceView = Boolean(options.sourceView);
  const nativeWidth = sourceView ? view.width : layout.width;
  const nativeHeight = sourceView ? view.height : layout.height;
  const scale = options.maxSide ? Math.min(1, options.maxSide / Math.max(nativeWidth, nativeHeight)) : 1;
  canvas.width = Math.max(1, Math.round(nativeWidth * scale));
  canvas.height = Math.max(1, Math.round(nativeHeight * scale));
  const grade = colorGrade(photo.edits);
  const ctx = canvas.getContext('2d', {willReadFrequently: Boolean(grade)});
  if (!ctx) throw Error('Браузер не смог подготовить отпечаток.');
  const source = sourceView ? full() : layout.source;
  const destination = sourceView ? full() : layout.destination;
  const dx = destination.x * canvas.width, dy = destination.y * canvas.height;
  const dw = destination.width * canvas.width, dh = destination.height * canvas.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.translate(dx, dy);
  ctx.scale(dw / (source.width * view.width), dh / (source.height * view.height));
  ctx.translate((0.5 - source.x) * view.width, (0.5 - source.y) * view.height);
  ctx.scale(photo.edits?.mirrorX ? -1 : 1, photo.edits?.mirrorY ? -1 : 1);
  ctx.rotate(view.radians);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, -photo.asset.width / 2, -photo.asset.height / 2, photo.asset.width, photo.asset.height);
  ctx.restore();
  if (grade) {
    const left = Math.floor(dx), right = Math.min(canvas.width, Math.ceil(dx + dw));
    const top = Math.floor(dy), bottom = Math.min(canvas.height, Math.ceil(dy + dh));
    let lastYield = performance.now();
    for (let y = top; y < bottom; y += 96) {
      const strip = ctx.getImageData(left, y, right - left, Math.min(96, bottom - y));
      gradePixels(strip.data, grade);
      ctx.putImageData(strip, left, y);
      if (!options.maxSide && performance.now() - lastYield > 24) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!valid()) return;
        lastYield = performance.now();
      }
    }
  }
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = sourceView ? '#edece7' : layout.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

export async function renderPrint(photo, format, catalog) {
  const canvas = document.createElement('canvas');
  try {
    await paintPrint(canvas, photo, format, catalog);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    if (!blob) throw Error('Браузеру не хватило памяти для подготовки отпечатка.');
    const density = Math.round(Math.min(300, 6000 * 2.54 / Math.max(format.width, format.height)));
    return await jpegWithPrintDensity(blob, density);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
