const rubles = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'RUB'});

export function printOrderText(spec) {
  const lines = [
    'Заказ № ' + spec.orderNumber,
    'Копицентр: ' + spec.center + ' (' + spec.centerId + ')',
    'Количество отпечатков: ' + spec.totalCopies,
    'Стоимость печати: ' + rubles.format(spec.total),
    '',
    'Для печати используйте файлы JPEG, указанные в каждой строке «Печатать».',
    'Папки originals содержат исходники клиента.',
    ''
  ];
  spec.photos.forEach((photo, i) => {
    lines.push(
      (i + 1) + '. ' + photo.originalName,
      '   Формат: ' + photo.formatLabel + ' · ' + photo.copies + ' шт.',
      '   Бумага: ' + photo.paperLabel,
      '   Кадрирование: ' + photo.fitLabel + (photo.crop ? ', ручная обрезка' : ''),
      '   Рамка: ' + photo.frameLabel,
      '   Дополнительные услуги: ' + (photo.extras?.map(extra => extra.label).join(', ') || '—'),
      '   Цена за экземпляр: ' + rubles.format(photo.unitPrice),
      '   Печатать: ' + photo.printArchiveFile,
      '   Оригинал: ' + (photo.originalArchiveFile || photo.archiveFile),
      ''
    );
  });
  return lines.join('\r\n');
}
