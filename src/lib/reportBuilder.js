/**
 * Report templates + universal report runner (client-side).
 */
import { evaluateFormula } from './formulas.js';
import { parseNumeric, roundMoney } from './parse.js';

export function createTemplateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyReportStructure() {
  return {
    rows: [
      {
        number: 1,
        code: '01',
        name: 'Показатель 1',
        level: 0,
        type: 'calculation',
        zone: '',
        sign: '+',
        hidden: false,
      },
    ],
    columns: [{ code: 'VAL', name: 'Значение', type: 'static', format: 'number', decimals: 2 }],
    cellRules: {},
  };
}

export function makeReportTemplate({
  id,
  name = 'Новый отчёт',
  group = 'Общие',
  comment = '',
  structure,
} = {}) {
  const now = Date.now();
  return {
    id: id || createTemplateId(),
    name: String(name).trim() || 'Новый отчёт',
    group: String(group || 'Общие'),
    comment: String(comment || ''),
    structure: structure || emptyReportStructure(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };
}

function cellKey(rowNumber, colCode) {
  return `row:${rowNumber},col:${colCode}`;
}

function evalRowTotalExpression(expr, rowValues, colCode) {
  // Supports [n] references and + - * / constants
  const tokens = String(expr || '')
    .replace(/\[(\d+)\]/g, (_, n) => ` ${rowValues[`${n}:${colCode}`] ?? 0} `)
    .replace(/([+\-*/()])/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const output = [];
  const ops = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const apply = () => {
    const op = ops.pop();
    const b = output.pop() ?? 0;
    const a = output.pop() ?? 0;
    if (op === '+') output.push(a + b);
    else if (op === '-') output.push(a - b);
    else if (op === '*') output.push(a * b);
    else if (op === '/') output.push(b === 0 ? 0 : a / b);
  };

  for (const t of tokens) {
    if (/^-?\d+(\.\d+)?$/.test(t)) output.push(parseFloat(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') apply();
      ops.pop();
    } else if ('+-*/'.includes(t)) {
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        (precedence[ops[ops.length - 1]] || 0) >= (precedence[t] || 0)
      ) {
        apply();
      }
      ops.push(t);
    }
  }
  while (ops.length) apply();
  return roundMoney(output[0] ?? 0);
}

/**
 * Run universal report for a template.
 * @returns {{ columns, rows, matrix, drilldown, errors }}
 */
export function runUniversalReport({
  template,
  sources,
  formulas = [],
  periodLabel = '',
  comparePeriods = [],
}) {
  if (!template?.structure) throw new Error('Не выбран шаблон отчёта');
  const { rows, columns, cellRules } = template.structure;
  const periods = [{ id: 'base', label: periodLabel || 'Период' }, ...comparePeriods];
  const outColumns = ['code', 'name', ...periods.flatMap((p) => columns.map((c) => `${c.code}::${p.id}`))];
  const matrix = []; // display rows
  const drilldown = {}; // key -> source rows
  const errors = [];
  const rowValues = {}; // `${rowNumber}:${colCode}` -> number (base period)

  // First pass: formula / constant cells for base period
  for (const row of rows || []) {
    if (row.hidden) continue;
    const display = { code: row.code, name: row.name, level: row.level || 0, type: row.type };
    for (const col of columns || []) {
      const key = cellKey(row.number, col.code);
      const rule = cellRules?.[key] || { type: 'empty' };
      let value = null;
      try {
        if (rule.type === 'constant') {
          value = parseNumeric(rule.value);
        } else if (rule.type === 'formula') {
          const fml = formulas.find((f) => f.id === rule.formulaId && !f.isDeleted);
          if (!fml) throw new Error(`Формула не найдена`);
          const result = evaluateFormula(fml.config, sources, formulas);
          value = result.value;
          drilldown[`${row.number}:${col.code}`] = {
            type: 'formula',
            formulaId: fml.id,
            arguments: result.arguments,
          };
        } else if (rule.type === 'empty') {
          value = null;
        }
        // rowTotal / colTotal handled in second pass
      } catch (err) {
        errors.push({ row: row.number, col: col.code, message: err.message });
        value = null;
      }
      if (rule.type === 'formula' || rule.type === 'constant') {
        rowValues[`${row.number}:${col.code}`] = value ?? 0;
        display[`${col.code}::base`] = value;
      }
    }
    matrix.push(display);
  }

  // Second pass: row totals
  for (const row of rows || []) {
    if (row.hidden) continue;
    const display = matrix.find((m) => m.code === row.code && m.name === row.name) || null;
    if (!display) continue;
    for (const col of columns || []) {
      const key = cellKey(row.number, col.code);
      const rule = cellRules?.[key];
      if (rule?.type !== 'rowTotal') continue;
      try {
        const value = evalRowTotalExpression(rule.expression, rowValues, col.code);
        rowValues[`${row.number}:${col.code}`] = value;
        display[`${col.code}::base`] = value;
      } catch (err) {
        errors.push({ row: row.number, col: col.code, message: err.message });
      }
    }
  }

  // Column totals (SUM down calculation rows for each col)
  for (const col of columns || []) {
    for (const row of rows || []) {
      const key = cellKey(row.number, col.code);
      const rule = cellRules?.[key];
      if (rule?.type !== 'colTotal') continue;
      const display = matrix.find((m) => m.code === row.code);
      if (!display) continue;
      const sum = (rows || [])
        .filter((r) => r.type === 'calculation' && !r.hidden)
        .reduce((s, r) => s + (rowValues[`${r.number}:${col.code}`] || 0), 0);
      const value = roundMoney(sum);
      rowValues[`${row.number}:${col.code}`] = value;
      display[`${col.code}::base`] = value;
    }
  }

  return {
    columns: outColumns,
    columnHeaders: [
      { key: 'code', label: 'Код' },
      { key: 'name', label: 'Показатель' },
      ...periods.flatMap((p) =>
        columns.map((c) => ({
          key: `${c.code}::${p.id}`,
          label: periods.length > 1 ? `${c.name} (${p.label})` : c.name,
        }))
      ),
    ],
    rows: matrix,
    drilldown,
    errors,
  };
}

/**
 * Import report structure from Excel-like rows (code + name columns).
 */
export function importStructureFromRows(rows, { codeCol, nameCol, start = 0 } = {}) {
  if (!rows?.length) return emptyReportStructure();
  const keys = Object.keys(rows[0]);
  const cCol = codeCol || keys[0];
  const nCol = nameCol || keys[1] || keys[0];
  const slice = rows.slice(start);
  const structure = emptyReportStructure();
  structure.rows = slice.map((r, i) => {
    const code = String(r[cCol] ?? '').trim() || String(i + 1);
    const level = Math.max(0, (code.match(/\./g) || []).length);
    return {
      number: i + 1,
      code,
      name: String(r[nCol] ?? '').trim() || `Строка ${i + 1}`,
      level,
      type: 'calculation',
      zone: '',
      sign: '+',
      hidden: false,
    };
  });
  structure.cellRules = {};
  return structure;
}

/**
 * Parse simple Excel formula text into rowTotal expression using row numbers by column letter map.
 * Limited: =B5+B6 → [5]+[6] when B maps to current column semantics (row refs only).
 */
export function excelFormulaToRowTotal(formula) {
  const f = String(formula || '').trim().replace(/^=/, '');
  return f.replace(/[A-Za-z]+(\d+)/g, (_, row) => `[${row}]`);
}

const TPL_STORAGE = 'turbohub_report_templates_v1';
const SETTINGS_STORAGE = 'turbohub_report_settings_v1';

export function loadTemplatesFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TPL_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemplatesToStorage(list) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TPL_STORAGE, JSON.stringify(list || []));
}

export function upsertTemplate(list, tpl) {
  const arr = list || [];
  const idx = arr.findIndex((t) => t.id === tpl.id);
  const next = { ...tpl, updatedAt: Date.now() };
  if (idx < 0) return [...arr, next];
  const out = arr.slice();
  out[idx] = { ...next, version: (arr[idx].version || 1) + 1 };
  return out;
}

export function loadReportSettings() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReportSettings(list) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(list || []));
}
