/**
 * Double-entry journal cell calculation + drill-down funnel.
 *
 * Cell = Row (accounts) × Column (period + filters) × optional Path (analytics).
 * getFilteredTransactions and calculateDoubleEntrySum share the same funnel so
 * the drill-down footer matches the cell value to the kopeck.
 */
import { cellText, columnsFromData, parseNumeric, roundMoney } from './parse.js';
import { detectPostingColumns } from './reports1c.js';

/** Parse date to YYYY-MM-DD comparable string, or null. */
export function toDateKey(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial (days since 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    return new Date(epoch).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/** Account match: exact or child sub-account (50 matches 50.01). */
export function accountMatches(code, targets = []) {
  const c = String(code || '').trim();
  if (!c || !targets?.length) return false;
  return targets.some((t) => {
    const f = String(t || '').trim();
    if (!f) return false;
    return c === f || c.startsWith(`${f}.`);
  });
}

export function accountsMatchAny(debit, credit, targets) {
  return accountMatches(debit, targets) || accountMatches(credit, targets);
}

/**
 * Normalize a registry posting row into a canonical transaction.
 * Keeps all original fields for dynamic analytic columns in drill-down.
 */
export function normalizeTransaction(row, mapping = {}) {
  const accountDebit = String(row[mapping.accountDt] ?? row.accountDebit ?? row['Счет Дт'] ?? row['Счёт Дт'] ?? '').trim();
  const accountCredit = String(row[mapping.accountCt] ?? row.accountCredit ?? row['Счет Кт'] ?? row['Счёт Кт'] ?? '').trim();
  const amountCol = mapping.amount || 'Сумма';
  const dateCol = mapping.date || 'Дата';
  const amount = parseNumeric(row[amountCol] ?? row.amount ?? row.Сумма);
  const dateRaw = row[dateCol] ?? row.date ?? row.Дата;
  return {
    ...row,
    accountDebit,
    accountCredit,
    amount,
    date: dateRaw,
    dateKey: toDateKey(dateRaw),
  };
}

export function normalizeJournal(rows = [], columns = []) {
  const cols = columns.length ? columns : columnsFromData(rows);
  const mapping = detectPostingColumns(cols);
  return {
    mapping,
    transactions: (rows || []).map((r) => normalizeTransaction(r, mapping)),
  };
}

function passesTimeFilter(tx, indicatorType, startDate, endDate) {
  const start = startDate ? toDateKey(startDate) : null;
  const end = endDate ? toDateKey(endDate) : null;
  const d = tx.dateKey;
  // Missing date: keep for turnover/end if no bounds; conservative keep
  if (!d) return true;
  if (indicatorType === 'start_balance') {
    if (!start) return true;
    return d < start;
  }
  if (indicatorType === 'end_balance') {
    if (!end) return true;
    return d <= end;
  }
  // turnover (default)
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

function passesColumnFilters(tx, filters = []) {
  for (const f of filters || []) {
    const field = f.columnName || f.field;
    if (!field) continue;
    const selected = f.selectedValues || f.values || [];
    if (!selected.length) continue;
    const cell = cellText(tx, field);
    const ok = selected.some((v) => String(v).trim() === cell || String(v).trim().toLowerCase() === cell.toLowerCase());
    if (!ok) return false;
  }
  return true;
}

function passesPath(tx, pathObj) {
  if (!pathObj || typeof pathObj !== 'object') return true;
  return Object.entries(pathObj).every(([key, val]) => {
    if (val == null || val === '') return true;
    return cellText(tx, key) === String(val).trim();
  });
}

/**
 * Hard filter funnel — identical for cell calc and drill-down.
 *
 * @param {object[]} transactions  normalized journal
 * @param {object} rowParams  { accounts: string[] }
 * @param {object} colParams  { startDate, endDate, filters: [{columnName, selectedValues}] }
 * @param {object|null} pathObj  analytics path for expanded sub-rows
 * @param {object} rule  { type, indicatorType, metricType, expandAnalytic }
 */
export function getFilteredTransactions(
  transactions,
  rowParams,
  colParams,
  pathObj = null,
  rule = {}
) {
  const accounts = rowParams?.accounts || rowParams?.accountsList || [];
  const indicatorType = rule.indicatorType || 'turnover';
  const metricType = rule.metricType || 'debit';
  const expandAnalytic = rule.expandAnalytic || 'no';
  const startDate = colParams?.startDate || colParams?.dateFrom || '';
  const endDate = colParams?.endDate || colParams?.dateTo || '';
  const filters = colParams?.filters || [];

  return (transactions || []).filter((tx) => {
    // 1. Accounts: Dt OR Ct in row accounts
    if (!accountsMatchAny(tx.accountDebit, tx.accountCredit, accounts)) return false;

    // 2. Time by indicatorType
    if (!passesTimeFilter(tx, indicatorType, startDate, endDate)) return false;

    // 3. expandAnalytic side
    if (expandAnalytic === 'debit') {
      if (!accountMatches(tx.accountDebit, accounts)) return false;
    } else if (expandAnalytic === 'credit') {
      if (!accountMatches(tx.accountCredit, accounts)) return false;
    }

    // 4. Column filters
    if (!passesColumnFilters(tx, filters)) return false;

    // 5. Path (sub-row analytics)
    if (!passesPath(tx, pathObj)) return false;

    // 6. metricType side filter
    if (metricType === 'debit') {
      if (!accountMatches(tx.accountDebit, accounts)) return false;
    } else if (metricType === 'credit') {
      if (!accountMatches(tx.accountCredit, accounts)) return false;
    }
    // active_balance / passive_balance: both sides kept

    return true;
  });
}

/**
 * Sum filtered txs by metricType (footer / cell value).
 */
export function sumMetric(filtered, accounts, metricType = 'debit') {
  let drSum = 0;
  let crSum = 0;
  for (const tx of filtered || []) {
    const amt = parseNumeric(tx.amount);
    if (accountMatches(tx.accountDebit, accounts)) drSum += amt;
    if (accountMatches(tx.accountCredit, accounts)) crSum += amt;
  }
  drSum = roundMoney(drSum);
  crSum = roundMoney(crSum);
  let total = 0;
  if (metricType === 'active_balance') total = roundMoney(drSum - crSum);
  else if (metricType === 'passive_balance') total = roundMoney(crSum - drSum);
  else if (metricType === 'credit') total = crSum;
  else total = drSum; // debit
  return { total, drSum, crSum };
}

/**
 * Cell value — same funnel as drill-down, returns Number.
 * Formula cells must be handled by the caller (drill-down blocked).
 */
export function calculateDoubleEntrySum(transactions, rowParams, colParams, pathObj, rule) {
  if (rule?.type === 'formula') {
    throw new Error('Drill-down / DB-sum недоступны для ячеек типа formula');
  }
  const filtered = getFilteredTransactions(transactions, rowParams, colParams, pathObj, rule);
  const accounts = rowParams?.accounts || [];
  return sumMetric(filtered, accounts, rule?.metricType || 'debit').total;
}

/**
 * Full drill-down payload for the modal.
 */
export function buildDrillDown(transactions, rowParams, colParams, pathObj, rule, meta = {}) {
  if (rule?.type === 'formula') {
    return {
      blocked: true,
      reason: 'Ячейка рассчитана формулой — расшифровка до проводок недоступна',
      transactions: [],
      total: null,
      drSum: 0,
      crSum: 0,
      meta,
    };
  }
  const filtered = getFilteredTransactions(transactions, rowParams, colParams, pathObj, rule);
  const accounts = rowParams?.accounts || [];
  const { total, drSum, crSum } = sumMetric(filtered, accounts, rule?.metricType || 'debit');
  return {
    blocked: false,
    transactions: filtered,
    total,
    drSum,
    crSum,
    metricType: rule?.metricType || 'debit',
    indicatorType: rule?.indicatorType || 'turnover',
    accounts,
    pathObj: pathObj || null,
    meta,
  };
}

/** Static + dynamic column headers for drill-down table. */
export function drillDownColumns(transactions = []) {
  const base = ['Дата', 'Счет Дт', 'Счет Кт', 'Сумма'];
  const skip = new Set([
    'Дата',
    'Счет Дт',
    'Счет Кт',
    'Сумма',
    'date',
    'dateKey',
    'accountDebit',
    'accountCredit',
    'amount',
    'Счёт Дт',
    'Счёт Кт',
  ]);
  const dynamic = [];
  const seen = new Set();
  for (const tx of transactions) {
    for (const key of Object.keys(tx)) {
      if (skip.has(key) || seen.has(key)) continue;
      // skip internal mapping duplicates when Russian labels already present
      if (/^account/i.test(key) || key === 'dateKey') continue;
      seen.add(key);
      dynamic.push(key);
    }
  }
  return { base, dynamic, all: [...base, ...dynamic] };
}

export function defaultCellRule(overrides = {}) {
  return {
    type: 'db',
    indicatorType: 'turnover',
    metricType: 'debit',
    expandAnalytic: 'no',
    ...overrides,
  };
}
