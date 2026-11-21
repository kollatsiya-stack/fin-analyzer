/**
 * Standard 1C-style accounting reports over a flat postings table from the registry.
 *
 * Expected posting columns (auto-detected with heuristics):
 *   accountDt, accountCt, amount, date (optional), analytics Дт:/Кт: columns.
 */
import { cellText, columnsFromData, norm, parseNumeric, roundMoney } from './parse.js';

function findCol(columns, patterns) {
  for (const re of patterns) {
    const hit = (columns || []).find((c) => re.test(String(c)));
    if (hit) return hit;
  }
  return '';
}

export function detectPostingColumns(columns = []) {
  return {
    accountDt: findCol(columns, [/счет\s*[дd][тt]/i, /[дd][тt].*счет/i, /^дебет$/i]),
    accountCt: findCol(columns, [/счет\s*[кk][тt]/i, /[кk][тt].*счет/i, /^кредит$/i]),
    amount: findCol(columns, [/^сумма$/i, /amount/i, /оборот/i]),
    date: findCol(columns, [/дата/i, /^date$/i, /период/i]),
  };
}

function accountPrefixMatch(code, filter) {
  if (!filter) return true;
  const c = String(code || '').trim();
  const f = String(filter || '').trim();
  if (!f) return true;
  return c === f || c.startsWith(f + '.') || c.startsWith(f);
}

function inPeriod(row, dateCol, from, to) {
  if (!dateCol || (!from && !to)) return true;
  const raw = row[dateCol];
  if (raw == null || raw === '') return true;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // Excel serial or DD.MM.YYYY
    const m = String(raw).match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      const parsed = new Date(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
      if (Number.isNaN(parsed.getTime())) return true;
      if (from && parsed < new Date(from)) return false;
      if (to && parsed > new Date(to)) return false;
      return true;
    }
    return true;
  }
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to)) return false;
  return true;
}

function emptyBucket() {
  return {
    openingDt: 0,
    openingCt: 0,
    turnoverDt: 0,
    turnoverCt: 0,
    closingDt: 0,
    closingCt: 0,
  };
}

function finalizeBalances(bucket) {
  // Net closing: positive → Dt, negative → Ct (simplified actively/passively neutral view).
  const net =
    bucket.openingDt -
    bucket.openingCt +
    bucket.turnoverDt -
    bucket.turnoverCt;
  if (net >= 0) {
    bucket.closingDt = roundMoney(net);
    bucket.closingCt = 0;
  } else {
    bucket.closingDt = 0;
    bucket.closingCt = roundMoney(-net);
  }
  bucket.openingDt = roundMoney(bucket.openingDt);
  bucket.openingCt = roundMoney(bucket.openingCt);
  bucket.turnoverDt = roundMoney(bucket.turnoverDt);
  bucket.turnoverCt = roundMoney(bucket.turnoverCt);
  return bucket;
}

/**
 * Trial balance (ОСВ) for all or selected accounts.
 */
export function buildOsv({
  postings = [],
  columns,
  accountFilter = '',
  dateFrom = '',
  dateTo = '',
  mapping,
}) {
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = { ...detectPostingColumns(cols), ...mapping };
  if (!map.accountDt && !map.accountCt) {
    throw new Error('Не найдены колонки счетов Дт/Кт в таблице проводок');
  }
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const byAccount = new Map();
  const ensure = (acc) => {
    const key = String(acc || '').trim() || '(пусто)';
    if (!byAccount.has(key)) byAccount.set(key, emptyBucket());
    return byAccount.get(key);
  };

  for (const row of postings) {
    if (!inPeriod(row, map.date, dateFrom, dateTo)) continue;
    const sum = parseNumeric(row[map.amount]);
    if (!sum) continue;
    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    if (dt && accountPrefixMatch(dt, accountFilter)) ensure(dt).turnoverDt += sum;
    if (ct && accountPrefixMatch(ct, accountFilter)) ensure(ct).turnoverCt += sum;
  }

  const toRow = (account, bucket) => ({
    Счет: account,
    'Сальдо вх. Дт': bucket.openingDt,
    'Сальдо вх. Кт': bucket.openingCt,
    'Оборот Дт': bucket.turnoverDt,
    'Оборот Кт': bucket.turnoverCt,
    'Сальдо исх. Дт': bucket.closingDt,
    'Сальдо исх. Кт': bucket.closingCt,
  });

  const rows = Array.from(byAccount.entries())
    .map(([account, bucket]) => {
      finalizeBalances(bucket);
      return toRow(account, bucket);
    })
    .sort((a, b) => String(a.Счет).localeCompare(String(b.Счет), 'ru', { numeric: true }));

  const totals = emptyBucket();
  for (const r of rows) {
    totals.openingDt += r['Сальдо вх. Дт'];
    totals.openingCt += r['Сальдо вх. Кт'];
    totals.turnoverDt += r['Оборот Дт'];
    totals.turnoverCt += r['Оборот Кт'];
    totals.closingDt += r['Сальдо исх. Дт'];
    totals.closingCt += r['Сальдо исх. Кт'];
  }
  finalizeBalances(totals);

  const outColumns = [
    'Счет',
    'Сальдо вх. Дт',
    'Сальдо вх. Кт',
    'Оборот Дт',
    'Оборот Кт',
    'Сальдо исх. Дт',
    'Сальдо исх. Кт',
  ];

  return {
    columns: outColumns,
    data: rows,
    totals: toRow('Итого', totals),
  };
}

/**
 * Account card — journal of postings for one account with running balance.
 */
export function buildAccountCard({
  postings = [],
  columns,
  account,
  dateFrom = '',
  dateTo = '',
  mapping,
}) {
  if (!account) throw new Error('Укажите счёт для карточки');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = { ...detectPostingColumns(cols), ...mapping };
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const analyticsCols = cols.filter((c) => /^Дт:|^Кт:|Подразделение/i.test(c));
  let balance = 0;
  const data = [];

  for (const row of postings) {
    if (!inPeriod(row, map.date, dateFrom, dateTo)) continue;
    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    const isDt = accountPrefixMatch(dt, account) && dt;
    const isCt = accountPrefixMatch(ct, account) && ct;
    if (!isDt && !isCt) continue;
    const sum = parseNumeric(row[map.amount]);
    const debit = isDt ? sum : 0;
    const credit = isCt ? sum : 0;
    balance = roundMoney(balance + debit - credit);
    const out = {
      Дата: map.date ? row[map.date] : '',
      'Счёт Дт': dt,
      'Счёт Кт': ct,
      'Сумма Дт': debit || '',
      'Сумма Кт': credit || '',
      Сальдо: balance,
    };
    for (const c of analyticsCols) out[c] = row[c] ?? '';
    data.push(out);
  }

  return {
    columns: Object.keys(data[0] || {
      Дата: '',
      'Счёт Дт': '',
      'Счёт Кт': '',
      'Сумма Дт': '',
      'Сумма Кт': '',
      Сальдо: '',
    }),
    data,
  };
}

/**
 * Account analysis — turnovers of selected account by corresponding accounts.
 */
export function buildAccountAnalysis({
  postings = [],
  columns,
  account,
  dateFrom = '',
  dateTo = '',
  mapping,
  analyticsCol = '',
}) {
  if (!account) throw new Error('Укажите счёт для анализа');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = { ...detectPostingColumns(cols), ...mapping };
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const byCorr = new Map();
  for (const row of postings) {
    if (!inPeriod(row, map.date, dateFrom, dateTo)) continue;
    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    const sum = parseNumeric(row[map.amount]);
    const isDt = accountPrefixMatch(dt, account) && dt;
    const isCt = accountPrefixMatch(ct, account) && ct;
    if (!isDt && !isCt) continue;

    const corr = isDt ? ct || '(без корреспонденции)' : dt || '(без корреспонденции)';
    const analytics = analyticsCol ? cellText(row, analyticsCol) || '(пусто)' : '';
    const key = analyticsCol ? `${corr}|||${analytics}` : corr;
    if (!byCorr.has(key)) {
      byCorr.set(key, {
        'Корр. счёт': corr,
        Аналитика: analytics,
        'Оборот Дт': 0,
        'Оборот Кт': 0,
      });
    }
    const bucket = byCorr.get(key);
    if (isDt) bucket['Оборот Дт'] += sum;
    if (isCt) bucket['Оборот Кт'] += sum;
  }

  const data = Array.from(byCorr.values())
    .map((r) => ({
      ...r,
      'Оборот Дт': roundMoney(r['Оборот Дт']),
      'Оборот Кт': roundMoney(r['Оборот Кт']),
    }))
    .sort((a, b) => String(a['Корр. счёт']).localeCompare(String(b['Корр. счёт']), 'ru'));

  const columnsOut = analyticsCol
    ? ['Корр. счёт', 'Аналитика', 'Оборот Дт', 'Оборот Кт']
    : ['Корр. счёт', 'Оборот Дт', 'Оборот Кт'];

  return { columns: columnsOut, data };
}

/**
 * Subconto analysis — balances/turnovers by analytics type column and account.
 */
export function buildSubcontoAnalysis({
  postings = [],
  columns,
  analyticsCol,
  side = 'dt',
  dateFrom = '',
  dateTo = '',
  mapping,
}) {
  if (!analyticsCol) throw new Error('Выберите колонку аналитики (вид субконто)');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = { ...detectPostingColumns(cols), ...mapping };
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const accountCol = side === 'ct' ? map.accountCt : map.accountDt;
  if (!accountCol) throw new Error('Не найдена колонка счёта для выбранной стороны');

  const byKey = new Map();
  for (const row of postings) {
    if (!inPeriod(row, map.date, dateFrom, dateTo)) continue;
    const analytics = cellText(row, analyticsCol);
    if (!analytics) continue;
    const account = cellText(row, accountCol);
    const sum = parseNumeric(row[map.amount]);
    const key = `${analytics}|||${account}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        Аналитика: analytics,
        Счет: account,
        'Оборот Дт': 0,
        'Оборот Кт': 0,
      });
    }
    const bucket = byKey.get(key);
    if (side === 'dt') bucket['Оборот Дт'] += sum;
    else bucket['Оборот Кт'] += sum;
  }

  const data = Array.from(byKey.values())
    .map((r) => ({
      ...r,
      'Оборот Дт': roundMoney(r['Оборот Дт']),
      'Оборот Кт': roundMoney(r['Оборот Кт']),
      Сальдо: roundMoney(r['Оборот Дт'] - r['Оборот Кт']),
    }))
    .sort((a, b) =>
      String(a.Аналитика).localeCompare(String(b.Аналитика), 'ru') ||
      String(a.Счет).localeCompare(String(b.Счет), 'ru', { numeric: true })
    );

  return {
    columns: ['Аналитика', 'Счет', 'Оборот Дт', 'Оборот Кт', 'Сальдо'],
    data,
  };
}

export function listAnalyticsColumns(columns = []) {
  return (columns || []).filter((c) => /^Дт:\s|^Кт:\s|Подразделение/i.test(String(c)));
}
