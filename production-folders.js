const safeCode = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const encoder = new TextEncoder();

function checkCode(value) {
  if (typeof value !== 'string' || !safeCode.test(value)) throw Error('Проверьте коды форматов и опций печати.');
  return value;
}

// Frames, margins and crops were rendered into each JPEG. Group by the settings
// that the operator still needs to apply to these full-size sheets.
function folderIdentity(row) {
  const formatId = checkCode(row.formatId);
  const paperId = checkCode(row.paperId);
  const extraIds = [...(row.extraIds || [])].map(checkCode).sort();
  if (new Set(extraIds).size !== extraIds.length) throw Error('Проверьте дополнительные услуги печати.');
  const paper = paperId === 'mt' ? 'mat' : paperId;
  const parts = [formatId, paper, 'brbp'];
  for (const id of extraIds) parts.push('opt-' + id);
  const candidate = parts.join('_');
  return {
    key: ['@jpeg', formatId, paperId, ...extraIds].join('|'),
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
