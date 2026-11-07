export const documentPhotoDefaults = {
  enabled:true,
  heading:'Заказать готовые фотографии на документы со скидкой 50%',
  helpItems:[
    'Загрузите готовый снимок с однотонным светлым фоном.',
    'Выберите размер и совместите голову с направляющими.',
    'Проверьте комплект, добавьте его в корзину и выберите копицентр при оформлении.'
  ],
  formats:[
    ['doc-30x40',30,40,6,2,3,600,300],
    ['doc-35x45',35,45,4,2,2,600,300],
    ['doc-40x60',40,60,4,2,2,600,300],
    ['doc-90x120',90,120,1,1,1,600,300],
    ['doc-51x51',51,51,2,1,2,null,null],
    ['doc-33x48',33,48,4,2,2,null,null],
    ['doc-43x55',43,55,2,1,2,null,null]
  ].map(([id,widthMm,heightMm,count,columns,rows,basePrice,price]) => ({
    id,label:widthMm+' × '+heightMm+' мм',widthMm,heightMm,count,columns,rows,
    basePrice,price,sheetWidthMm:100,sheetHeightMm:150,gapMm:2,marginMm:5,available:price !== null,
    guides:{top:10,eyes:40,chin:80,width:60}
  }))
};
export const documentDemoStorageKey = 'copycenter-documents-config-v1';
export function readDocumentDemoConfig() {
  try {
    const value = JSON.parse(localStorage.getItem(documentDemoStorageKey));
    if (value && Array.isArray(value.formats) && value.formats.length && Array.isArray(value.helpItems)) return value;
  } catch { /* A malformed local demo setting must not prevent opening the editor. */ }
  return structuredClone(documentPhotoDefaults);
}
export function saveDocumentDemoConfig(value) {
  localStorage.setItem(documentDemoStorageKey, JSON.stringify(value));
}
