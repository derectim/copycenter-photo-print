// Public demonstration rates. The installed module reads the shop's own catalog.
const tiers = (prices) => prices.map((price, i) => ({ min: [1, 51, 101, 501][i], price }));
const format = (id, width, height, prices) => ({
  id, label: width + ' × ' + height + ' см', width, height,
  tiers: tiers(prices),
  paperIds: ['gl', 'mt'], fitIds: ['cover', 'contain'], frameIds: ['none', 'white'], extraIds: ['color', 'urgent']
});

export const demoCatalog = {
  formats: [
    format('10x15', 10, 15, [30, 20, 17.5, 15]),
    format('10x10', 10, 10, [30, 20, 17.5, 15]),
    { ...format('15x20', 15, 20, [60, 55, 50]), quoteLimit: 500 },
    { ...format('20x30', 20, 30, [200]), quoteLimit: 50 },
    { ...format('30x40', 30, 40, [400]), quoteLimit: 50 }
  ],
  papers: [
    { id: 'gl', label: 'Глянцевая', surcharge: 0 },
    { id: 'mt', label: 'Матовая', surcharge: 0 }
  ],
  fits: [
    { id: 'cover', label: 'В обрез', surcharge: 0 },
    { id: 'contain', label: 'Целиком с полями', surcharge: 0 }
  ],
  frames: [
    { id: 'none', label: 'Без рамки', surcharge: 0 },
    { id: 'white', label: 'Белая рамка', surcharge: 0 }
  ],
  extras: [
    { id: 'color', label: 'Цветокоррекция', surcharge: 5 },
    { id: 'urgent', label: 'Срочная печать', surcharge: 10 }
  ],
  centers: [
    { id: 'KIT', label: 'Китай-город · Маросейка, 2/15с1' },
    { id: 'SOK', label: 'Сокольники · Сокольническая пл., 4к1–2' },
    { id: 'SEM', label: 'Семёновская · Щербаковская, 7А' }
  ]
};
