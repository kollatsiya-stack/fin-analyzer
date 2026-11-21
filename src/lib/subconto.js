import { cellText, columnsFromData, norm } from './parse.js';

/**
 * Развёртывание позиционных субконто проводок по Плану счетов.
 *
 * Для каждой проводки типы аналитики берутся из строки плана счетов
 * (с подъёмом по иерархии родительских счетов, если у субсчёта типы пусты).
 * Значения «Субконто 1/2/3» и «Подразделение» раскладываются в именованные
 * колонки с явным разделением сторон:
 *   - `Дт: <Тип субконто>`, `Подразделение Дт`
 *   - `Кт: <Тип субконто>`, `Подразделение Кт`
 */

function findCol(columns, patterns) {
  const cols = columns || [];
  for (const re of patterns) {
    const hit = cols.find((c) => re.test(String(c)));
    if (hit) return hit;
  }
  return '';
}

/** Heuristic column mapping for typical 1C / Turbohub exports. */
export function detectSubcontoColumns(postColumns = [], coaColumns = []) {
  return {
    postAccountDt: findCol(postColumns, [
      /счет\s*[дd][тt]/i,
      /[дd][тt].*счет/i,
      /дебет.*счет|счет.*дебет/i,
      /^дебет$|^дт$/i,
    ]),
    postAccountCt: findCol(postColumns, [
      /счет\s*[кk][тt]/i,
      /[кk][тt].*счет/i,
      /кредит.*счет|счет.*кредит/i,
      /^кредит$|^кт$/i,
    ]),
    postSubDt1: findCol(postColumns, [/субконто\s*1.*[дd]|[дd].*субконто\s*1|субконто1\s*[дd]/i]),
    postSubDt2: findCol(postColumns, [/субконто\s*2.*[дd]|[дd].*субконто\s*2|субконто2\s*[дd]/i]),
    postSubDt3: findCol(postColumns, [/субконто\s*3.*[дd]|[дd].*субконто\s*3|субконто3\s*[дd]/i]),
    postSubCt1: findCol(postColumns, [/субконто\s*1.*[кk]|[кk].*субконто\s*1|субконто1\s*[кk]/i]),
    postSubCt2: findCol(postColumns, [/субконто\s*2.*[кk]|[кk].*субконто\s*2|субконто2\s*[кk]/i]),
    postSubCt3: findCol(postColumns, [/субконто\s*3.*[кk]|[кk].*субконто\s*3|субконто3\s*[кk]/i]),
    // Fallback: unmarked positional subconto columns (Субконто 1/2/3) → treat as Dt.
    // Applied later only if side-specific columns are missing.
    postDivDt: findCol(postColumns, [/подраздел.*[дd]|[дd].*подраздел/i]),
    postDivCt: findCol(postColumns, [/подраздел.*[кk]|[кk].*подраздел/i]),
    coaAccount: findCol(coaColumns, [/^счет$/i, /^код$/i, /код\s*счета/i, /^account$/i, /номер\s*счета/i]),
    coaParent: findCol(coaColumns, [/родител/i, /вышестоящ/i, /parent/i, /счет\s*родитель/i]),
    coaType1: findCol(coaColumns, [
      /вид.*субконто\s*1|субконто\s*1.*вид|тип.*субконто\s*1|субконто\s*1$/i,
      /^субконто1$/i,
    ]),
    coaType2: findCol(coaColumns, [
      /вид.*субконто\s*2|субконто\s*2.*вид|тип.*субконто\s*2|субконто\s*2$/i,
      /^субконто2$/i,
    ]),
    coaType3: findCol(coaColumns, [
      /вид.*субконто\s*3|субконто\s*3.*вид|тип.*субконто\s*3|субконто\s*3$/i,
      /^субконто3$/i,
    ]),
  };
}

function applyPositionalFallback(detected, postColumns) {
  const next = { ...detected };
  if (!next.postSubDt1) {
    next.postSubDt1 = findCol(postColumns, [/^субконто\s*1$/i, /^субконто1$/i]);
  }
  if (!next.postSubDt2) {
    next.postSubDt2 = findCol(postColumns, [/^субконто\s*2$/i, /^субконто2$/i]);
  }
  if (!next.postSubDt3) {
    next.postSubDt3 = findCol(postColumns, [/^субконто\s*3$/i, /^субконто3$/i]);
  }
  if (!next.postDivDt) {
    next.postDivDt = findCol(postColumns, [/^подразделение$/i]);
  }
  return next;
}

function normalizeAccountCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/,/g, '.');
}

/**
 * Build account → { types: [t1,t2,t3], parent } index and resolve types
 * walking up the parent chain when a sub-account has empty type slots.
 */
export function buildCoaIndex(coaData, { accountCol, parentCol, typeCols }) {
  const byCode = new Map();
  for (const row of coaData || []) {
    const code = normalizeAccountCode(row[accountCol]);
    if (!code) continue;
    byCode.set(norm(code), {
      code,
      parent: parentCol ? normalizeAccountCode(row[parentCol]) : '',
      types: typeCols.map((col) => (col ? cellText(row, col) : '')),
    });
  }

  const resolveTypes = (rawCode) => {
    const code = normalizeAccountCode(rawCode);
    if (!code) return ['', '', ''];
    const merged = ['', '', ''];
    let current = norm(code);
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const node = byCode.get(current);
      if (!node) break;
      for (let i = 0; i < 3; i += 1) {
        if (!merged[i] && node.types[i]) merged[i] = node.types[i];
      }
      if (merged.every(Boolean)) break;
      current = node.parent ? norm(node.parent) : '';
    }
    // Soft hierarchy fallback: strip trailing ".NN" segments (41.01 → 41).
    if (merged.some((t) => !t)) {
      let soft = code;
      while (soft.includes('.')) {
        soft = soft.replace(/\.[^.]+$/, '');
        const node = byCode.get(norm(soft));
        if (!node) continue;
        for (let i = 0; i < 3; i += 1) {
          if (!merged[i] && node.types[i]) merged[i] = node.types[i];
        }
        if (merged.every(Boolean)) break;
      }
    }
    return merged;
  };

  return { byCode, resolveTypes };
}

function sidePrefix(side) {
  return side === 'ct' ? 'Кт' : 'Дт';
}

function analyticsColName(side, typeName) {
  const prefix = sidePrefix(side);
  const type = String(typeName || '').trim() || 'Субконто';
  return `${prefix}: ${type}`;
}

function divisionColName(side) {
  return side === 'ct' ? 'Подразделение Кт' : 'Подразделение Дт';
}

/**
 * Expand postings subconto into named analytics columns.
 *
 * @param {object} args
 * @param {object[]} args.postings
 * @param {object[]} args.coa
 * @param {object} [args.config] column mapping (partial OK — rest auto-detected)
 * @returns {{ data: object[], columns: string[], mapping: object, addedColumns: string[] }}
 */
export function expandSubconto({ postings, coa, config = {} }) {
  if (!postings?.length) throw new Error('Нет строк в таблице проводок');
  if (!coa?.length) throw new Error('Нет строк в плане счетов');

  const postColumns = columnsFromData(postings);
  const coaColumns = columnsFromData(coa);
  const detected = applyPositionalFallback(
    { ...detectSubcontoColumns(postColumns, coaColumns), ...config },
    postColumns
  );

  const accountDt = detected.postAccountDt;
  const accountCt = detected.postAccountCt;
  if (!accountDt && !accountCt) {
    throw new Error(
      'Не удалось определить колонки счетов Дт/Кт в проводках. Укажите их вручную.'
    );
  }
  if (!detected.coaAccount) {
    throw new Error(
      'Не удалось определить колонку кода счёта в плане счетов. Укажите её вручную.'
    );
  }

  const { resolveTypes } = buildCoaIndex(coa, {
    accountCol: detected.coaAccount,
    parentCol: detected.coaParent,
    typeCols: [detected.coaType1, detected.coaType2, detected.coaType3],
  });

  const subDt = [detected.postSubDt1, detected.postSubDt2, detected.postSubDt3];
  const subCt = [detected.postSubCt1, detected.postSubCt2, detected.postSubCt3];

  const addedSet = new Set();
  const data = postings.map((row) => {
    const out = { ...row };

    const applySide = (side, accountCol, subCols, divCol) => {
      if (!accountCol) return;
      const types = resolveTypes(row[accountCol]);
      for (let i = 0; i < 3; i += 1) {
        const srcCol = subCols[i];
        if (!srcCol) continue;
        const typeName = types[i] || `Субконто ${i + 1}`;
        const dest = analyticsColName(side, typeName);
        out[dest] = row[srcCol] ?? '';
        addedSet.add(dest);
      }
      if (divCol) {
        const dest = divisionColName(side);
        out[dest] = row[divCol] ?? '';
        addedSet.add(dest);
      }
    };

    applySide('dt', accountDt, subDt, detected.postDivDt);
    applySide('ct', accountCt, subCt, detected.postDivCt);
    return out;
  });

  const addedColumns = Array.from(addedSet);
  const columns = columnsFromData(data);
  return { data, columns, mapping: detected, addedColumns };
}
