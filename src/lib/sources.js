import { columnsFromData } from './parse.js';

/** @typedef {'gsheet' | 'excel' | 'csv' | 'derived'} SourceType */

/**
 * @typedef {object} DataSource
 * @property {string} id
 * @property {string} name
 * @property {SourceType} type
 * @property {string[]} columns
 * @property {Record<string, unknown>[]} data
 * @property {string} [origin]
 * @property {number} createdAt
 * @property {Record<string, unknown>} [meta]
 */

export function createSourceId() {
  return `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Infer source type from a local file name. */
export function detectFileType(fileName = '') {
  const n = String(fileName).toLowerCase();
  if (n.endsWith('.csv')) return 'csv';
  if (n.endsWith('.xls') || n.endsWith('.xlsx')) return 'excel';
  return 'excel';
}

/**
 * Build a registry entry from parsed workbook data (one sheet = one source).
 * @param {object} opts
 * @returns {DataSource}
 */
export function makeSource({
  name,
  type = 'excel',
  data = [],
  columns,
  origin = '',
  meta = {},
  id,
} = {}) {
  const cols = columns?.length ? columns : columnsFromData(data);
  return {
    id: id || createSourceId(),
    name: String(name || 'Без названия').trim() || 'Без названия',
    type,
    data: Array.isArray(data) ? data : [],
    columns: cols,
    origin: origin || '',
    createdAt: Date.now(),
    meta: { ...meta },
  };
}

/** @param {DataSource[]} sources @param {string} id */
export function getSource(sources, id) {
  if (!id) return null;
  return (sources || []).find((s) => s.id === id) || null;
}

/** Insert or replace a source by id. */
export function upsertSource(sources, source) {
  const list = sources || [];
  const idx = list.findIndex((s) => s.id === source.id);
  if (idx < 0) return [...list, source];
  const next = list.slice();
  next[idx] = source;
  return next;
}

export function removeSource(sources, id) {
  return (sources || []).filter((s) => s.id !== id);
}

/** Unique display name: append (2), (3), … if needed. */
export function uniqueSourceName(sources, desired) {
  const base = String(desired || 'Таблица').trim() || 'Таблица';
  const taken = new Set((sources || []).map((s) => s.name));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/**
 * Register every sheet of a parsed workbook as a separate source entry.
 * Returns the list of newly created sources (does not mutate `sources`).
 */
export function sourcesFromWorkbook(parsed, { type, origin, namePrefix, existing = [] } = {}) {
  const sheets = parsed?.sheets?.length ? parsed.sheets : [parsed?.activeSheet || 'Лист1'];
  const created = [];
  let registry = existing.slice();
  for (const sheetName of sheets) {
    const pack = parsed.allData?.[sheetName] || {
      data: sheetName === parsed.activeSheet ? parsed.data : [],
      columns: sheetName === parsed.activeSheet ? parsed.columns : [],
    };
    const labelBase =
      sheets.length > 1
        ? `${namePrefix || origin || 'Таблица'} · ${sheetName}`
        : namePrefix || sheetName || origin || 'Таблица';
    const name = uniqueSourceName([...registry, ...created], labelBase);
    const source = makeSource({
      name,
      type: type || 'excel',
      data: pack.data || [],
      columns: pack.columns || [],
      origin: origin || '',
      meta: { sheet: sheetName },
    });
    created.push(source);
  }
  return created;
}

export function typeLabel(type) {
  switch (type) {
    case 'gsheet':
      return 'Google Sheets';
    case 'csv':
      return 'CSV';
    case 'derived':
      return 'Производная';
    case 'excel':
    default:
      return 'Excel';
  }
}
