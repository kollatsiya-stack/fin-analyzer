/**
 * Pivot report: Row (accounts) × Column (period + filters) → double-entry cell.
 * Formula cells supported; drill-down only for type === 'db'.
 */
import {
  buildDrillDown,
  calculateDoubleEntrySum,
  defaultCellRule,
  getFilteredTransactions,
} from './doubleEntry.js';
import { evaluateFormula } from './formulas.js';
import { cellText, roundMoney } from './parse.js';

export function createTemplateId() {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createRowId() {
  return `row_${Math.random().toString(36).slice(2, 8)}`;
}

export function createColId() {
  return `col_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyReportStructure() {
  const rowId = createRowId();
  const colId = createColId();
  return {
    rows: [
      {
        id: rowId,
        name: 'Денежные средства',
        accounts: ['50', '51'],
        expandBy: '',
        level: 0,
      },
    ],
    columns: [
      {
        id: colId,
        name: 'Период',
        startDate: '',
        endDate: '',
        filters: [],
      },
    ],
    /** rules[rowId][colId] = cell rule */
    rules: {
      [rowId]: {
        [colId]: defaultCellRule({ metricType: 'active_balance' }),
      },
    },
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

export function getCellRule(structure, rowId, colId) {
  return structure?.rules?.[rowId]?.[colId] || defaultCellRule();
}

export function setCellRule(structure, rowId, colId, rule) {
  const rules = { ...(structure.rules || {}) };
  rules[rowId] = { ...(rules[rowId] || {}), [colId]: { ...defaultCellRule(), ...rule } };
  return { ...structure, rules };
}

/**
 * Build expanded display rows (parent + analytic children when expandBy set).
 */
function expandRowNodes(row, transactions, columns, structure) {
  const nodes = [{ row, pathObj: null, isChild: false }];
  if (!row.expandBy) return nodes;

  const values = new Set();
  for (const col of columns) {
    const rule = getCellRule(structure, row.id, col.id);
    if (rule.type === 'formula') continue;
    const filtered = getFilteredTransactions(
      transactions,
      { accounts: row.accounts },
      col,
      null,
      { ...rule, expandAnalytic: rule.expandAnalytic || 'debit' }
    );
    for (const tx of filtered) {
      const v = cellText(tx, row.expandBy);
      if (v) values.add(v);
    }
  }
  const sorted = Array.from(values).sort((a, b) => a.localeCompare(b, 'ru'));
  for (const v of sorted) {
    nodes.push({
      row: {
        ...row,
        id: `${row.id}::${v}`,
        name: v,
        level: (row.level || 0) + 1,
        parentId: row.id,
      },
      pathObj: { [row.expandBy]: v },
      isChild: true,
      parentRowId: row.id,
    });
  }
  return nodes;
}

function evalFormulaCell(rule, sources, formulas) {
  if (!rule.formulaId) return null;
  const fml = (formulas || []).find((f) => f.id === rule.formulaId && !f.isDeleted);
  if (!fml) throw new Error('Формула не найдена');
  return evaluateFormula(fml.config, sources, formulas).value;
}

/**
 * Run pivot report over normalized transactions.
 * @returns matrix rows with cell values + contexts for drill-down
 */
export function runUniversalReport({
  template,
  transactions = [],
  sources = [],
  formulas = [],
  globalStartDate = '',
  globalEndDate = '',
}) {
  if (!template?.structure) throw new Error('Не выбран шаблон отчёта');
  const { rows, columns, rules } = template.structure;
  const errors = [];
  const displayRows = [];
  const cells = {}; // key `${displayRowId}|${colId}` -> { value, context }

  for (const baseRow of rows || []) {
    const nodes = expandRowNodes(baseRow, transactions, columns || [], template.structure);
    for (const node of nodes) {
      const display = {
        id: node.row.id,
        name: node.row.name,
        level: node.row.level || 0,
        accounts: baseRow.accounts,
        pathObj: node.pathObj,
        parentRowId: node.parentRowId || baseRow.id,
        isChild: node.isChild,
        values: {},
      };

      for (const col of columns || []) {
        const rule = getCellRule(template.structure, baseRow.id, col.id);
        const colParams = {
          startDate: col.startDate || globalStartDate,
          endDate: col.endDate || globalEndDate,
          filters: col.filters || [],
        };
        const rowParams = { accounts: baseRow.accounts || [] };
        let value = null;
        try {
          if (rule.type === 'formula') {
            value = evalFormulaCell(rule, sources, formulas);
          } else if (rule.type === 'constant') {
            value = Number(rule.value) || 0;
          } else {
            value = calculateDoubleEntrySum(
              transactions,
              rowParams,
              colParams,
              node.pathObj,
              rule
            );
          }
        } catch (err) {
          errors.push({ row: display.name, col: col.name, message: err.message });
          value = null;
        }
        display.values[col.id] = value;
        cells[`${display.id}|${col.id}`] = {
          value,
          rule,
          rowParams,
          colParams,
          pathObj: node.pathObj,
          rowName: node.isChild ? `${baseRow.name} › ${display.name}` : display.name,
          colName: col.name,
          baseRowId: baseRow.id,
          colId: col.id,
          drillable: rule.type === 'db' && value != null,
        };
      }
      displayRows.push(display);
    }
  }

  return {
    columns: columns || [],
    rows: displayRows,
    cells,
    errors,
    rules,
  };
}

/** Open drill-down for a cell context. */
export function drillDownFromCell(transactions, cellCtx) {
  if (!cellCtx) return null;
  if (!cellCtx.drillable || cellCtx.rule?.type === 'formula') {
    return buildDrillDown(transactions, cellCtx.rowParams, cellCtx.colParams, cellCtx.pathObj, {
      type: 'formula',
    }, { rowName: cellCtx.rowName, colName: cellCtx.colName });
  }
  return buildDrillDown(
    transactions,
    cellCtx.rowParams,
    cellCtx.colParams,
    cellCtx.pathObj,
    cellCtx.rule,
    { rowName: cellCtx.rowName, colName: cellCtx.colName }
  );
}

/**
 * Import report structure from Excel-like rows (code + name → accounts from name heuristics).
 */
export function importStructureFromRows(rows, { codeCol, nameCol, accountsCol, start = 0 } = {}) {
  if (!rows?.length) return emptyReportStructure();
  const keys = Object.keys(rows[0]);
  const cCol = codeCol || keys[0];
  const nCol = nameCol || keys[1] || keys[0];
  const aCol = accountsCol || keys.find((k) => /счет/i.test(k)) || keys[2];
  const slice = rows.slice(start);
  const structure = emptyReportStructure();
  const colId = structure.columns[0].id;
  structure.rows = slice.map((r) => {
    const id = createRowId();
    const accountsRaw = aCol ? String(r[aCol] ?? '') : '';
    const accounts = accountsRaw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      id,
      name: String(r[nCol] ?? r[cCol] ?? '').trim() || 'Показатель',
      accounts: accounts.length ? accounts : ['51'],
      expandBy: '',
      level: 0,
    };
  });
  structure.rules = {};
  for (const row of structure.rows) {
    structure.rules[row.id] = { [colId]: defaultCellRule({ metricType: 'active_balance' }) };
  }
  return structure;
}

export function excelFormulaToRowTotal(formula) {
  const f = String(formula || '').trim().replace(/^=/, '');
  return f.replace(/[A-Za-z]+(\d+)/g, (_, row) => `[${row}]`);
}

/** Legacy helper kept for older tests / formula grids — sums referenced cells. */
export function evalRowTotalExpression(expr, rowValues, colCode) {
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

// Re-export for callers that only import reportBuilder
export { defaultCellRule };
