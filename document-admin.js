import {readDocumentDemoConfig, saveDocumentDemoConfig} from './document-photo-demo-config.js?v=2.4.0';
import {mountDocumentConfigEditor} from './document-config-editor.js?v=2.4.0';

const stored = readDocumentDemoConfig();
const first = stored.formats[0];
const config = {
  enabled:stored.enabled,heading:stored.heading,helpItems:stored.helpItems,
  sheetWidthMm:first?.sheetWidthMm ?? 100,sheetHeightMm:first?.sheetHeightMm ?? 150,
  marginMm:first?.marginMm ?? 5,gapMm:first?.gapMm ?? 2,
  formats:stored.formats.map(format => ({
    id:format.id,label:format.label,widthMm:format.widthMm,heightMm:format.heightMm,
    count:format.count,columns:format.columns,rows:format.rows,guides:format.guides,
    basePriceKopecks:format.basePrice == null ? null : Math.round(format.basePrice * 100)
  }))
};
const editor = mountDocumentConfigEditor(document.getElementById('document-config-fields'), config);
document.getElementById('document-admin-form').addEventListener('submit', event => {
  event.preventDefault();
  const error = document.getElementById('document-admin-error');
  const status = document.getElementById('document-admin-status');
  try {
    const value = editor.read();
    saveDocumentDemoConfig({
      enabled:value.enabled,heading:value.heading,helpItems:value.helpItems,discountPercent:50,
      cta:'Заказать готовые фотографии на документы со скидкой 50%',
      formats:value.formats.map(({basePriceKopecks,...format}) => ({
        ...format,basePrice:basePriceKopecks == null ? null : basePriceKopecks / 100,
        price:basePriceKopecks == null ? null : Math.round(basePriceKopecks / 2) / 100,
        available:value.enabled && basePriceKopecks !== null,
        sheetWidthMm:value.sheetWidthMm,sheetHeightMm:value.sheetHeightMm,marginMm:value.marginMm,gapMm:value.gapMm
      }))
    });
    error.hidden = true;
    status.textContent = 'Сохранено. Откройте страницу услуги или загрузчик, чтобы увидеть изменения.';
  } catch (exception) {
    status.textContent = '';
    error.textContent = exception.message;
    error.hidden = false;
    error.scrollIntoView({block:'nearest'});
  }
});
