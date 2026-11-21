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

function resolveMapping(postings, coa, config = {}) {
  const postColumns = columnsFromData(postings);
  const coaColumns = columnsFromData(coa);
  return applyPositionalFallback(
    { ...detectSubcontoColumns(postColumns, coaColumns), ...config },
    postColumns
  );
}

function typeDictId(typeName) {
  return `type:${norm(typeName)}`;
}

function divisionDictId(side) {
  return `div:${side}`;
}

function slotDictId(side, slotIndex) {
  return `slot:${side}:${slotIndex + 1}`;
}

/**
 * List справочники / analytics the user can choose to expand.
 * Preference order: named COA types → positional slots → divisions.
 *
 * @returns {{ id: string, kind: 'type'|'slot'|'division', label: string, typeName?: string, side?: string, slot?: number, sides: string[], description: string }[]}
 */
export function listSubcontoDictionaries({ postings, coa, config = {} }) {
  if (!postings?.length || !coa?.length) return [];
  const detected = resolveMapping(postings, coa, config);
  if (!detected.coaAccount) return [];

  const { resolveTypes } = buildCoaIndex(coa, {
    accountCol: detected.coaAccount,
    parentCol: detected.coaParent,
    typeCols: [detected.coaType1, detected.coaType2, detected.coaType3],
  });

  const subDt = [detected.postSubDt1, detected.postSubDt2, detected.postSubDt3];
  const subCt = [detected.postSubCt1, detected.postSubCt2, detected.postSubCt3];

  /** @type {Map<string, { id: string, kind: string, label: string, typeName?: string, sides: Set<string>, slots: Set<string>, description: string }>} */
  const byId = new Map();

  const noteType = (side, slotIndex, typeName) => {
    const clean = String(typeName || '').trim();
    if (clean) {
      const id = typeDictId(clean);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          kind: 'type',
          label: clean,
          typeName: clean,
          sides: new Set(),
          slots: new Set(),
          description: '',
        });
      }
      const entry = byId.get(id);
      entry.sides.add(side);
      entry.slots.add(`${sidePrefix(side)} · позиция ${slotIndex + 1}`);
      return;
    }
    // Unnamed type → positional fallback option.
    const id = slotDictId(side, slotIndex);
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        kind: 'slot',
        label: `Субконто ${slotIndex + 1} (${sidePrefix(side)})`,
        side,
        slot: slotIndex + 1,
        sides: new Set([side]),
        slots: new Set(),
        description: `Позиция ${slotIndex + 1} без вида в плане счетов`,
      });
    }
  };

  const scanAccounts = (side, accountCol, subCols) => {
    if (!accountCol) return;
    const seenAccounts = new Set();
    for (const row of postings) {
      const code = normalizeAccountCode(row[accountCol]);
      if (!code || seenAccounts.has(code)) continue;
      seenAccounts.add(code);
      const types = resolveTypes(code);
      for (let i = 0; i < 3; i += 1) {
        if (!subCols[i]) continue;
        noteType(side, i, types[i]);
      }
    }
  };

  scanAccounts('dt', detected.postAccountDt, subDt);
  scanAccounts('ct', detected.postAccountCt, subCt);

  // Also harvest types directly from COA rows (covers types not present in sample postings).
  for (const row of coa) {
    for (const col of [detected.coaType1, detected.coaType2, detected.coaType3]) {
      if (!col) continue;
      const clean = cellText(row, col);
      if (!clean) continue;
      const id = typeDictId(clean);
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          kind: 'type',
          label: clean,
          typeName: clean,
          sides: new Set(),
          slots: new Set(),
          description: 'Вид из плана счетов',
        });
      }
    }
  }

  if (detected.postDivDt) {
    byId.set(divisionDictId('dt'), {
      id: divisionDictId('dt'),
      kind: 'division',
      label: 'Подразделение Дт',
      side: 'dt',
      sides: new Set(['dt']),
      slots: new Set(),
      description: 'Аналитика подразделения по дебету',
    });
  }
  if (detected.postDivCt) {
    byId.set(divisionDictId('ct'), {
      id: divisionDictId('ct'),
      kind: 'division',
      label: 'Подразделение Кт',
      side: 'ct',
      sides: new Set(['ct']),
      slots: new Set(),
      description: 'Аналитика подразделения по кредиту',
    });
  }

  return Array.from(byId.values())
    .map((entry) => {
      const sides = Array.from(entry.sides);
      const slots = Array.from(entry.slots);
      let description = entry.description || '';
      if (entry.kind === 'type') {
        const sideLabel = sides.length
          ? sides.map((s) => sidePrefix(s)).join(' / ')
          : 'Дт / Кт';
        description = slots.length
          ? `Справочник · ${sideLabel} (${slots.join(', ')})`
          : `Справочник · ${sideLabel}`;
      }
      return {
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        typeName: entry.typeName,
        side: entry.side,
        slot: entry.slot,
        sides,
        description,
      };
    })
    .sort((a, b) => {
      const order = { type: 0, slot: 1, division: 2 };
      return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.label.localeCompare(b.label, 'ru');
    });
}

/**
 * Expand postings subconto into named analytics columns.
 *
 * @param {object} args
 * @param {object[]} args.postings
 * @param {object[]} args.coa
 * @param {object} [args.config] column mapping (partial OK — rest auto-detected)
 * @param {string[]|null} [args.selectedIds] dictionary ids from listSubcontoDictionaries;
 *   `null`/`undefined` = all; `[]` = none (no analytics columns added)
 * @returns {{ data: object[], columns: string[], mapping: object, addedColumns: string[], selectedIds: string[] }}
 */
export function expandSubconto({ postings, coa, config = {}, selectedIds = null }) {
  if (!postings?.length) throw new Error('Нет строк в таблице проводок');
  if (!coa?.length) throw new Error('Нет строк в плане счетов');

  const detected = resolveMapping(postings, coa, config);

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

  const dictionaries = listSubcontoDictionaries({ postings, coa, config: detected });
  const allIds = dictionaries.map((d) => d.id);
  const activeIds = selectedIds == null ? allIds : selectedIds.filter((id) => allIds.includes(id));
  const active = new Set(activeIds);

  if (selectedIds != null && active.size === 0) {
    throw new Error('Выберите хотя бы один справочник / субконто для развёртывания');
  }

  const allowedTypeNames = new Set(
    dictionaries.filter((d) => d.kind === 'type' && active.has(d.id)).map((d) => norm(d.typeName))
  );
  const allowedSlots = new Set(
    dictionaries
      .filter((d) => d.kind === 'slot' && active.has(d.id))
      .map((d) => `${d.side}:${d.slot}`)
  );
  const allowDivDt = active.has(divisionDictId('dt'));
  const allowDivCt = active.has(divisionDictId('ct'));

  const { resolveTypes } = buildCoaIndex(coa, {
    accountCol: detected.coaAccount,
    parentCol: detected.coaParent,
    typeCols: [detected.coaType1, detected.coaType2, detected.coaType3],
  });

  const subDt = [detected.postSubDt1, detected.postSubDt2, detected.postSubDt3];
  const subCt = [detected.postSubCt1, detected.postSubCt2, detected.postSubCt3];

  const slotAllowed = (side, slotIndex, typeName) => {
    const clean = String(typeName || '').trim();
    if (clean) return allowedTypeNames.has(norm(clean));
    return allowedSlots.has(`${side}:${slotIndex + 1}`);
  };

  const addedSet = new Set();
  const data = postings.map((row) => {
    const out = { ...row };

    const applySide = (side, accountCol, subCols, divCol, allowDiv) => {
      if (!accountCol) return;
      const types = resolveTypes(row[accountCol]);
      for (let i = 0; i < 3; i += 1) {
        const srcCol = subCols[i];
        if (!srcCol) continue;
        const typeName = types[i] || '';
        if (!slotAllowed(side, i, typeName)) continue;
        const dest = analyticsColName(side, typeName || `Субконто ${i + 1}`);
        out[dest] = row[srcCol] ?? '';
        addedSet.add(dest);
      }
      if (divCol && allowDiv) {
        const dest = divisionColName(side);
        out[dest] = row[divCol] ?? '';
        addedSet.add(dest);
      }
    };

    applySide('dt', accountDt, subDt, detected.postDivDt, allowDivDt);
    applySide('ct', accountCt, subCt, detected.postDivCt, allowDivCt);
    return out;
  });

  const addedColumns = Array.from(addedSet);
  const columns = columnsFromData(data);
  return { data, columns, mapping: detected, addedColumns, selectedIds: activeIds };
}
