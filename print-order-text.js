import { presetLabels, toneLabels } from './photo-color.js';

const rubles = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'});

function editLines(edits) {
  if (!edits) return [];
  const list = [];
  if (edits.angle) list.push('Поворот: ' + edits.angle + '°');
  if (edits.orientation && edits.orientation !== 'auto') {
    list.push('Ориентация: ' + (edits.orientation === 'portrait' ? 'портретная' : 'альбомная'));
  }
  if (edits.mirrorX || edits.mirrorY) {
    list.push('Отражение: ' + [edits.mirrorX && 'по горизонтали', edits.mirrorY && 'по вертикали'].filter(Boolean).join(', '));
  }
  if (edits.preset && edits.preset !== 'none') list.push('Фильтр: ' + presetLabels[edits.preset]);
  for (const [key,label] of Object.entries(toneLabels)) {
    if (edits.tone?.[key]) list.push(label + ': ' + edits.tone[key]);
  }
  if (edits.frame?.color) list.push('Цвет рамки: ' + edits.frame.color);
  for (const [key,label] of Object.entries({left:'слева',right:'справа',top:'сверху',bottom:'снизу'})) {
    if (edits.frame?.[key] != null) list.push('Поле ' + label + ': ' + edits.frame[key] + ' мм');
  }
  return list.map(text => '   ' + text);
}

export function printOrderText(spec) {
  const lines = [
    'Заказ № ' + spec.orderNumber,
    'Копицентр: ' + spec.center + ' (' + spec.centerId + ')',
    'Количество отпечатков: ' + spec.totalCopies,
    'Стоимость печати: ' + rubles.format(spec.total),
    '',
    'Для печати откройте папку нужных параметров и отправьте каждый JPEG в печать один раз.',
    '',
    ...(spec.formats || []).map(f => f.label + ' · ' + f.copies + ' шт. · ' + rubles.format(f.total)),
    ''
  ];
  spec.photos.forEach((photo, i) => {
    lines.push(
      (i + 1) + '. ' + photo.originalName,
      '   Формат: ' + photo.formatLabel + ' · ' + photo.copies + ' шт.',
      '   Бумага: ' + photo.paperLabel,
      '   Кадрирование: ' + photo.fitLabel + (photo.crop ? ', ручная обрезка' : ''),
      '   Рамка: ' + photo.frameLabel,
      ...editLines(photo.edits),
      '   Дополнительные услуги: ' + (photo.extras?.map(extra => extra.label).join(', ') || '—'),
      '   Цена за экземпляр: ' + rubles.format(photo.unitPrice),
      '   Печатать: ' + (photo.printArchiveFiles || [photo.printArchiveFile]).join('\r\n             '),
      ''
    );
  });
  return lines.join('\r\n');
}
