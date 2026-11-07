import {paintPrint, jpegWithPrintDensity} from './print-render.js?v=2.4.0';

export const DOCUMENT_DPI = 300;
export const defaultDocumentGuides = {crown:0.10,eyes:0.40,chin:0.80,headWidth:0.60};
export const documentRenderCatalog = {frames:[{id:'none',preview:'none'}],fits:[{id:'cover',preview:'cover'}]};
const positive = value => Number.isFinite(value) && value > 0;
const pixels = mm => Math.max(1, Math.round(mm * DOCUMENT_DPI / 25.4));

export function documentCropFormat(preset) {
  if (!positive(preset.widthMm) || !positive(preset.heightMm)) throw Error('Проверьте размеры фотографии.');
  return {id:preset.id,width:preset.widthMm/10,height:preset.heightMm/10,label:preset.label};
}

export function documentCropPhoto(photo,preset) {
  return {...photo,frameId:'none',fitId:'cover',edits:{angle:photo.edits?.angle||0,
    orientation:preset.widthMm>preset.heightMm?'landscape':'portrait'}};
}

export function documentSheetLayout(preset) {
  const {widthMm,heightMm,sheetWidthMm,sheetHeightMm,count,columns,rows,gapMm,marginMm} = preset;
  if (![widthMm,heightMm,sheetWidthMm,sheetHeightMm].every(positive) ||
    ![count,columns,rows].every(n => Number.isInteger(n) && n > 0 && n <= 100) || count > columns*rows ||
    ![gapMm,marginMm].every(n => Number.isFinite(n) && n >= 0)) throw Error('Проверьте раскладку фотографий на листе.');
  const gridWidth = columns*widthMm + (columns-1)*gapMm;
  const gridHeight = rows*heightMm + (rows-1)*gapMm;
  if (gridWidth+2*marginMm > sheetWidthMm+.000001 || gridHeight+2*marginMm > sheetHeightMm+.000001) {
    throw Error('Фотографии с такими полями не помещаются на листе.');
  }
  const left = (sheetWidthMm-gridWidth)/2, top = (sheetHeightMm-gridHeight)/2;
  const positions = Array.from({length:count}, (_,index) => {
    const xMm = left+(index%columns)*(widthMm+gapMm);
    const yMm = top+Math.floor(index/columns)*(heightMm+gapMm);
    return {xMm,yMm,widthMm,heightMm,x:Math.round(xMm*DOCUMENT_DPI/25.4),y:Math.round(yMm*DOCUMENT_DPI/25.4),
      width:pixels(widthMm),height:pixels(heightMm)};
  });
  return {width:pixels(sheetWidthMm),height:pixels(sheetHeightMm),sheetWidthMm,sheetHeightMm,positions};
}

export function normalizeDocumentGuides(input = {}) {
  const number = (key, min, max) => Math.max(min, Math.min(max, Number.isFinite(input[key]) ? input[key] : defaultDocumentGuides[key]));
  const crown = number('crown', .01, .97);
  const chin = Math.max(crown+.02, number('chin', .03, .99));
  return {crown,chin,eyes:Math.max(crown+.01,Math.min(chin-.01,number('eyes',.02,.98))),headWidth:number('headWidth',.01,.99)};
}

export async function paintDocumentCrop(canvas, photo, preset, options = {}) {
  await paintPrint(canvas, documentCropPhoto(photo,preset),
    documentCropFormat(preset), documentRenderCatalog, options);
}

export async function paintDocumentSheet(canvas, photo, preset, options = {}) {
  const layout = documentSheetLayout(preset);
  const scale = options.maxSide ? Math.min(1,options.maxSide/Math.max(layout.width,layout.height)) : 1;
  const crop = document.createElement('canvas');
  try {
    await paintDocumentCrop(crop,photo,preset,{maxSide:options.maxSide ? Math.ceil(Math.max(pixels(preset.widthMm),pixels(preset.heightMm))*scale) : undefined,
      valid:options.valid});
    if (options.valid && !options.valid()) return;
    canvas.width = Math.max(1,Math.round(layout.width*scale));
    canvas.height = Math.max(1,Math.round(layout.height*scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Не удалось подготовить печатный лист.');
    context.fillStyle = '#ffffff'; context.fillRect(0,0,canvas.width,canvas.height);
    context.imageSmoothingQuality = 'high';
    for (const place of layout.positions) context.drawImage(crop,place.x*scale,place.y*scale,place.width*scale,place.height*scale);
  } finally { crop.width=crop.height=1; }
}

export async function renderDocumentSheet(photo,preset) {
  const canvas = document.createElement('canvas');
  try {
    await paintDocumentSheet(canvas,photo,preset);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.94));
    if (!blob) throw Error('Браузеру не хватило памяти для печатного листа.');
    return jpegWithPrintDensity(blob,DOCUMENT_DPI);
  } finally { canvas.width=canvas.height=1; }
}
