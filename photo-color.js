// Apply the same sRGB adjustments to the small proof and the full-resolution JPEG.
// Only image pixels are graded. The frame is composited after grading.
export const toneLabels = {
  whiteBalance: 'Баланс белого', tint: 'Оттенок', brightness: 'Яркость',
  contrast: 'Контраст', highlights: 'Светлые участки', shadows: 'Тени',
  saturation: 'Насыщенность', crossProcess: 'Кросс-процесс', vibrance: 'Сочность'
};
export const presetLabels = {
  none: 'Без фильтра', bw: 'Чёрно-белый', spring: 'Весна', retro: 'Ретро',
  pony: 'Пони', desert: 'Пустыня', morning: 'Утро', tokyo: 'Токио', shade: 'Тени'
};
const presets = {
  bw: { saturation: -100 },
  spring: { whiteBalance: 13, tint: -8, vibrance: 22, shadows: 8 },
  retro: { whiteBalance: 20, saturation: -35, contrast: -16, crossProcess: 24 },
  pony: { tint: 22, brightness: 7, saturation: 9, contrast: -14 },
  desert: { whiteBalance: 38, saturation: -16, contrast: 14 },
  morning: { whiteBalance: 17, shadows: 23, highlights: -7, contrast: -9 },
  tokyo: { whiteBalance: -21, tint: 10, contrast: 17, crossProcess: -19 },
  shade: { whiteBalance: -18, saturation: -24, shadows: -16, highlights: -7 }
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function colorGrade(edits) {
  const base = presets[edits?.preset] || {};
  const settings = {};
  for (const key of Object.keys(toneLabels)) {
    settings[key] = clamp((base[key] || 0) + (edits?.tone?.[key] || 0), -100, 100) / 100;
  }
  if (!Object.values(settings).some(Boolean)) return null;
  const tones = new Float32Array(256);
  const cross = new Float32Array(256);
  const contrast = 2 ** settings.contrast;
  for (let i = 0; i < 256; i++) {
    const luminance = i / 255;
    const shadow = (1 - luminance) ** 3;
    const high = luminance ** 3;
    tones[i] = (i - 128) * (contrast - 1) + settings.brightness * 96 +
      settings.shadows * 84 * shadow + settings.highlights * 84 * high;
    cross[i] = settings.crossProcess * (luminance - 0.5) * 65;
  }
  return {
    tones, cross, saturation: 1 + settings.saturation, vibrance: settings.vibrance,
    red: settings.whiteBalance * 36 + settings.tint * 10,
    green: -settings.tint * 28,
    blue: -settings.whiteBalance * 36 + settings.tint * 10
  };
}

export function gradePixels(pixels, grade) {
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const index = Math.round(luma);
    const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    const saturation = Math.max(0, grade.saturation * (1 + grade.vibrance * (1 - chroma)));
    const mid = luma + grade.tones[index];
    pixels[i]     = mid + (r - luma) * saturation + grade.red + grade.cross[index];
    pixels[i + 1] = mid + (g - luma) * saturation + grade.green;
    pixels[i + 2] = mid + (b - luma) * saturation + grade.blue - grade.cross[index];
  }
}
