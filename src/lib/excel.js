import * as XLSX from 'xlsx';
import { columnsFromData, deduplicateColumns } from './parse.js';

export function parseWorkbook(workbook) {
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) throw new Error('Файл не содержит листов');

  const allData = {};
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (json.length > 0) {
      const columns = deduplicateColumns(Object.keys(json[0]));
      const data = json.map((row) => {
        const cleanRow = {};
        Object.keys(row).forEach((k, i) => {
          cleanRow[columns[i] || k] = row[k];
        });
        return cleanRow;
      });
      allData[sheetName] = { data, columns };
    } else {
      const arr = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const cols = arr.length > 0 ? arr[0].map(String) : [];
      allData[sheetName] = { data: [], columns: deduplicateColumns(cols) };
    }
  }

  const activeSheet =
    sheetNames.find((name) => (allData[name]?.data?.length || 0) > 0) || sheetNames[0];

  return {
    sheets: sheetNames,
    activeSheet,
    allData,
    data: allData[activeSheet]?.data || [],
    columns: allData[activeSheet]?.columns || [],
  };
}

export function readArrayBuffer(buffer) {
  return parseWorkbook(XLSX.read(buffer, { type: 'array' }));
}

export function readFileAsWorkbook(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Файл не выбран'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(readArrayBuffer(e.target.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsArrayBuffer(file);
  });
}

function toGoogleExportUrl(link) {
  if (!link.includes('docs.google.com/spreadsheets')) return link;
  const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Неверная ссылка на Google Таблицу');
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
}

function looksLikeXlsx(buffer) {
  const arr = new Uint8Array(buffer).subarray(0, 2);
  return arr[0] === 0x50 && arr[1] === 0x4b;
}

export async function loadFromLink(link) {
  if (!link || typeof link !== 'string' || !/^https?:\/\//i.test(link.trim())) {
    throw new Error('Введите корректную ссылку, начинающуюся с http:// или https://');
  }

  const fetchUrl = toGoogleExportUrl(link.trim());
  const candidates = [
    fetchUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(fetchUrl)}`,
    `https://corsproxy.io/?url=${encodeURIComponent(fetchUrl)}`,
  ];

  let lastError = '';
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (looksLikeXlsx(buffer) || buffer.byteLength > 0) {
        try {
          const parsed = readArrayBuffer(buffer);
          return parsed;
        } catch (err) {
          lastError = err.message;
          if (looksLikeXlsx(buffer)) throw err;
        }
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(
    lastError
      ? `Не удалось скачать файл (${lastError}). Откройте доступ «Для всех, у кого есть ссылка».`
      : 'Не удалось скачать файл. Откройте доступ «Для всех, у кого есть ссылка».'
  );
}

export function exportToExcel(data, filename = 'Turbohub_Result.xlsx') {
  if (!data?.length) throw new Error('Нет данных для экспорта');
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Результат_ETL');
  XLSX.writeFile(workbook, filename);
}

export function parseMappingFile(buffer) {
  const parsed = readArrayBuffer(buffer);
  const json = parsed.data;
  if (!json.length) return [];
  const keys = Object.keys(json[0]);
  const c1 = keys.find((k) => k.toLowerCase().includes('исходн')) || keys[0];
  const c2 = keys.find((k) => k.toLowerCase().includes('эталон')) || keys[1];
  return json.map((r, i) => ({
    id: Date.now() + i,
    src: String(r[c1] || ''),
    target: String(r[c2] || ''),
  }));
}

/**
 * Read a two-column correspondence file into synonym pairs. The first column is
 * treated as the value in source 1, the second as the equivalent in source 2.
 */
export function pairsFromRows(rows) {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  if (keys.length < 2) return [];
  const c1 = keys.find((k) => /исходн|источник\s*1|source\s*1|слева|left/i.test(k)) || keys[0];
  const c2 =
    keys.find((k) => /эталон|соответ|источник\s*2|source\s*2|справа|right/i.test(k)) ||
    keys.find((k) => k !== c1) ||
    keys[1];
  return rows
    .map((r) => ({ a: String(r[c1] ?? '').trim(), b: String(r[c2] ?? '').trim() }))
    .filter((p) => p.a && p.b);
}

export { columnsFromData };
