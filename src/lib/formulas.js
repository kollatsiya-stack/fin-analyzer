/**
 * Visual formula templates + client-side evaluator over registry tables.
 * JSON config mirrors TurboHub TZ (arguments + expression AST).
 */
import { getSource } from './sources.js';
import { cellText, norm, parseNumeric, roundMoney } from './parse.js';

export function createFormulaId() {
  return `fml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeFormulaTemplate({
  id,
  name = 'Новая формула',
  group = 'Общие',
  comment = '',
  config,
} = {}) {
  const now = Date.now();
  return {
    id: id || createFormulaId(),
    name: String(name).trim() || 'Новая формула',
    group: String(group || 'Общие'),
    comment: String(comment || ''),
    config: config || emptyFormulaConfig(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };
}

export function emptyFormulaConfig() {
  return {
    arguments: [],
    expression: { type: 'compound', items: [] },
    comparison: null,
    periodOffset: null,
  };
}

export function makeArgument({
  id,
  name = 'Аргумент',
  sourceId = null,
  dataSlice = 'turnover',
  resourceCol = '',
  aggregation = 'SUM',
  filters = [],
  expandBy = '',
  vlookup = null,
  useNegative = false,
} = {}) {
  return {
    id: id || `arg_${Math.random().toString(36).slice(2, 7)}`,
    name,
    sourceId,
    dataSlice,
    resourceCol,
    aggregation,
    filters, // [{ logic:'AND', field, op, value }]
    expandBy,
    vlookup, // { sourceId, leftField, rightField, pullField }
    useNegative,
  };
}

function matchFilter(row, filter) {
  const cell = cellText(row, filter.field);
  const val = String(filter.value ?? '');
  const op = filter.op || 'равно';
  const c = norm(cell);
  const v = norm(val);
  switch (op) {
    case 'равно':
      return c === v;
    case 'не равно':
      return c !== v;
    case 'содержит':
      return c.includes(v);
    case 'не содержит':
      return !c.includes(v);
    case 'пусто':
      return !c;
    case 'не пусто':
      return !!c;
    case 'больше':
      return parseNumeric(cell) > parseNumeric(val);
    case 'меньше':
      return parseNumeric(cell) < parseNumeric(val);
    default:
      return c === v;
  }
}

function applyFilters(rows, filters) {
  const valid = (filters || []).filter((f) => f.field);
  if (!valid.length) return rows;
  return rows.filter((row) =>
    valid.reduce((acc, f, idx) => {
      const ok = matchFilter(row, f);
      if (idx === 0) return ok;
      return f.logic === 'OR' ? acc || ok : acc && ok;
    }, false)
  );
}

function applyVlookup(rows, sources, vlookup) {
  if (!vlookup?.sourceId || !vlookup.leftField || !vlookup.rightField || !vlookup.pullField) {
    return rows;
  }
  const dict = getSource(sources, vlookup.sourceId);
  if (!dict) return rows;
  const index = new Map();
  for (const r of dict.data) {
    index.set(norm(r[vlookup.rightField]), r[vlookup.pullField]);
  }
  return rows.map((r) => ({
    ...r,
    [vlookup.pullField]: index.get(norm(r[vlookup.leftField])) ?? null,
  }));
}

function aggregate(values, aggregation) {
  const nums = values.map(parseNumeric).filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  switch (aggregation) {
    case 'AVG':
      return roundMoney(nums.reduce((a, b) => a + b, 0) / nums.length);
    case 'COUNT':
      return nums.length;
    case 'MIN':
      return Math.min(...nums);
    case 'MAX':
      return Math.max(...nums);
    case 'SUM':
    default:
      return roundMoney(nums.reduce((a, b) => a + b, 0));
  }
}

/**
 * Evaluate a single argument → number and detail rows (for drill-down / expand).
 */
export function evaluateArgument(arg, sources, { expand = false } = {}) {
  const source = getSource(sources, arg.sourceId);
  if (!source) throw new Error(`Источник аргумента «${arg.name}» не найден в реестре`);
  if (!arg.resourceCol) throw new Error(`Не выбрана колонка-ресурс для «${arg.name}»`);

  let rows = applyFilters(source.data, arg.filters);
  rows = applyVlookup(rows, sources, arg.vlookup);

  if (expand && arg.expandBy) {
    const groups = new Map();
    for (const row of rows) {
      const key = cellText(row, arg.expandBy) || '(пусто)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const detail = Array.from(groups.entries()).map(([key, groupRows]) => {
      let value = aggregate(
        groupRows.map((r) => r[arg.resourceCol]),
        arg.aggregation || 'SUM'
      );
      if (arg.useNegative) value = roundMoney(-value);
      return { [arg.expandBy]: key, value, rows: groupRows };
    });
    const total = roundMoney(detail.reduce((s, d) => s + d.value, 0));
    return { value: total, detail, rows };
  }

  let value = aggregate(
    rows.map((r) => r[arg.resourceCol]),
    arg.aggregation || 'SUM'
  );
  if (arg.useNegative) value = roundMoney(-value);
  return { value, detail: null, rows };
}

function evalExpression(items, argResults, formulaCatalog, sources, stack = []) {
  if (!items?.length) return 0;
  // Shunting-yard-lite for + - * / and parentheses encoded as operators
  const output = [];
  const ops = [];
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };

  const pushValue = (n) => output.push(Number(n) || 0);
  const applyOp = () => {
    const op = ops.pop();
    const b = output.pop() ?? 0;
    const a = output.pop() ?? 0;
    let r = 0;
    if (op === '+') r = a + b;
    else if (op === '-') r = a - b;
    else if (op === '*') r = a * b;
    else if (op === '/') r = b === 0 ? 0 : a / b;
    output.push(r);
  };

  for (const item of items) {
    if (item.type === 'argument') {
      pushValue(argResults[item.ref]?.value ?? 0);
    } else if (item.type === 'constant') {
      pushValue(item.value);
    } else if (item.type === 'formula') {
      if (stack.includes(item.ref)) throw new Error('Циклическая ссылка на формулу');
      const nested = (formulaCatalog || []).find((f) => f.id === item.ref && !f.isDeleted);
      if (!nested) throw new Error(`Формула ${item.ref} не найдена`);
      const nestedResult = evaluateFormula(nested.config, sources, formulaCatalog, [
        ...stack,
        item.ref,
      ]);
      pushValue(nestedResult.value);
    } else if (item.type === 'operator') {
      const op = item.value;
      if (op === '(') ops.push(op);
      else if (op === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') applyOp();
        ops.pop();
      } else {
        while (
          ops.length &&
          ops[ops.length - 1] !== '(' &&
          (precedence[ops[ops.length - 1]] || 0) >= (precedence[op] || 0)
        ) {
          applyOp();
        }
        ops.push(op);
      }
    }
  }
  while (ops.length) applyOp();
  return roundMoney(output[0] ?? 0);
}

/**
 * Evaluate full formula config.
 * @returns {{ value: number, arguments: object, expression: string }}
 */
export function evaluateFormula(config, sources, formulaCatalog = [], stack = []) {
  const cfg = config || emptyFormulaConfig();
  const argResults = {};
  for (const arg of cfg.arguments || []) {
    argResults[arg.id] = evaluateArgument(arg, sources);
  }
  let value;
  if (!cfg.expression?.items?.length) {
    // Default: sum of all arguments
    value = roundMoney(
      Object.values(argResults).reduce((s, a) => s + (a.value || 0), 0)
    );
  } else {
    value = evalExpression(cfg.expression.items, argResults, formulaCatalog, sources, stack);
  }
  if (cfg.comparison?.operator != null && cfg.comparison?.value != null) {
    const thr = parseNumeric(cfg.comparison.value);
    const op = cfg.comparison.operator;
    const ok =
      (op === '>' && value > thr) ||
      (op === '<' && value < thr) ||
      (op === '=' && value === thr) ||
      (op === '≠' && value !== thr) ||
      (op === '≥' && value >= thr) ||
      (op === '≤' && value <= thr);
    if (!ok) value = 0;
  }
  return { value, arguments: argResults };
}

const FORMULA_STORAGE = 'turbohub_formula_templates_v1';

export function loadFormulasFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FORMULA_STORAGE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFormulasToStorage(list) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(FORMULA_STORAGE, JSON.stringify(list || []));
}

export function upsertFormula(list, formula) {
  const arr = list || [];
  const idx = arr.findIndex((f) => f.id === formula.id);
  const next = { ...formula, updatedAt: Date.now() };
  if (idx < 0) return [...arr, next];
  const out = arr.slice();
  out[idx] = { ...next, version: (arr[idx].version || 1) + 1 };
  return out;
}
