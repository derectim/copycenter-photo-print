const safeCode = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const frameEdges = ['left', 'top', 'right', 'bottom'];
const encoder = new TextEncoder();

function checkCode(value) {
  if (typeof value !== 'string' || !safeCode.test(value)) throw Error('Проверьте коды форматов и опций печати.');
  return value;
}

function frameMillimeters(frame) {
  if (!frame || !frameEdges.some(edge => frame[edge] != null)) return '';
  return frameEdges.map(edge => {
    if (frame[edge] == null) return 'd';
    const mm = frame[edge];
    if (!Number.isFinite(mm) || mm < 0 || mm > 5000) throw Error('Проверьте размеры полей рамки.');
    return Number(mm.toFixed(6)).toString();
  }).join('-');
}

// The archive's folder describes machine/production settings. Per-photo crop,
// rotation and tone are already applied to the JPEG and do not split a print run.
function folderIdentity(row) {
  const {formatId, paperId, fitId, fitStyle, frameId, frameStyle} = row;
  [formatId, paperId, fitId, fitStyle, frameId, frameStyle].forEach(checkCode);
  const extraIds = [...(row.extraIds || [])].map(checkCode).sort();
  if (new Set(extraIds).size !== extraIds.length) throw Error('Проверьте дополнительные услуги печати.');
  const frame = frameStyle === 'none' ? null : row.frameEdits;
  const mmPart = frameMillimeters(frame);
  if (frame?.color != null && (typeof frame.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(frame.color))) {
    throw Error('Проверьте цвет рамки.');
  }
  const colorPart = frame?.color?.slice(1).toLowerCase() || '';
  const paper = paperId === 'mt' ? 'mat' : paperId;
  const frameCode = frameStyle === 'none' ? 'br' : 'sr';
  const fieldCode = fitStyle === 'contain' ? 'sp' : 'bp';
  const parts = [formatId, paper, frameCode + fieldCode];
  if (frameId !== frameStyle || !['white', 'none'].includes(frameId)) {
    parts.push('ram-' + frameId + (frameId !== frameStyle ? '-' + frameStyle : ''));
  }
  if (fitId !== fitStyle || !['contain', 'cover'].includes(fitId)) parts.push('fit-' + fitId + '-' + fitStyle);
  if (mmPart) parts.push('mm-' + mmPart);
  if (colorPart) parts.push('c-' + colorPart);
  for (const id of extraIds) parts.push('opt-' + id);
  const candidate = parts.join('_');
  return {
    key: [formatId, paperId, fitId, fitStyle, frameId, frameStyle, mmPart, colorPart, ...extraIds].join('|'),
    candidate: candidate.length > 180 ? candidate.slice(0, 175) + '-more' : candidate
  };
}

export function productionRuns(rows) {
  const runs = new Map();
  for (const row of rows) {
    const {key, candidate} = folderIdentity(row);
    if (!runs.has(key)) runs.set(key, {folder: candidate, rows: []});
    runs.get(key).rows.push(row);
  }
  // Windows and macOS may extract names case-insensitively. Disambiguate all
  // folders for the ZIP together, in canonical order independent of photo order.
  const used = new Set();
  const sorted = [];
  for (const key of [...runs.keys()].sort()) {
    const run = runs.get(key);
    const base = run.folder;
    let sequence = 1;
    while (used.has(run.folder.toLowerCase())) run.folder = base + '_' + ++sequence;
    used.add(run.folder.toLowerCase());
    sorted.push(run);
  }
  return sorted;
}

export function safePrintBasename(name, byteLimit = 150) {
  const value = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
  let text = '', bytes = 0;
  for (const ch of value) {
    const width = encoder.encode(ch).length;
    if (bytes + width > byteLimit) break;
    text += ch;
    bytes += width;
  }
  return text.replace(/[. ]+$/g, '') || 'photo';
}
