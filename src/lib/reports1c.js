/**
 * Standard 1C-style reports over a registry postings table.
 *
 * Period rules:
 *   opening (dateFrom):  Дата < dateFrom
 *   turnover:            dateFrom <= Дата <= dateTo
 *   closing:             opening + turnover  (= all txs with Дата <= dateTo)
 *
 * Per-account balance split: net = Dt − Ct; if net >= 0 → Dt side, else Ct side.
 */
import { cellText, columnsFromData, parseNumeric, roundMoney, toDateKey } from './parse.js';

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
    document: findCol(columns, [/документ/i, /номер\s*док/i, /^док$/i]),
    content: findCol(columns, [/содержание|назначение|комментар|описание|текст/i]),
    organization: findCol(columns, [/организац/i, /фирм/i, /^org$/i]),
  };
}

/** 60.1 and 60.01 → same key «60.01» (sub-accounts padded to 2 digits). */
export function normalizeAccountCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const parts = raw.split('.');
  return parts
    .map((p, i) => {
      if (!/^\d+$/.test(p)) return p;
      if (i === 0) return String(parseInt(p, 10));
      return String(parseInt(p, 10)).padStart(2, '0');
    })
    .join('.');
}

export function accountMatchesFilter(code, filters) {
  if (!filters?.length) return true;
  const c = normalizeAccountCode(code);
  if (!c) return false;
  return filters.some((f) => {
    const n = normalizeAccountCode(f);
    if (!n) return false;
    return c === n || c.startsWith(`${n}.`);
  });
}

export function splitBalance(net) {
  const n = roundMoney(net);
  if (n >= 0) return { dt: n, ct: 0 };
  return { dt: 0, ct: roundMoney(-n) };
}

export function emptyBucket() {
  return { openNet: 0, turnoverDt: 0, turnoverCt: 0 };
}

export function listAnalyticsColumns(columns = []) {
  return (columns || []).filter((c) =>
    /^Дт:\s|^Кт:\s|Подразделение|Контрагент|Договор|Номенклатур|Стать/i.test(String(c))
  );
}

/** Build CoA lookup: normalized code → { displayCode, name }. */
export function buildCoaLookup(coaRows = [], coaColumns = []) {
  const accountCol =
    findCol(coaColumns, [/^счет$/i, /^код$/i, /код\s*счета/i, /^account$/i, /номер\s*счета/i]) ||
    coaColumns[0];
  const nameCol =
    findCol(coaColumns, [/наименован/i, /название/i, /^name$/i, /полное\s*имя/i]) ||
    coaColumns[1] ||
    '';
  const map = new Map();
  for (const row of coaRows || []) {
    const code = cellText(row, accountCol);
    if (!code) continue;
    const key = normalizeAccountCode(code);
    if (!key || map.has(key)) continue;
    map.set(key, {
      displayCode: code,
      name: nameCol ? cellText(row, nameCol) : '',
    });
  }
  return map;
}

function resolveMapping(columns, mapping) {
  return { ...detectPostingColumns(columns), ...mapping };
}

function passesFilters(row, filters = {}) {
  if (filters.organization && filters.organizationCol) {
    const v = cellText(row, filters.organizationCol);
    if (v !== String(filters.organization).trim()) return false;
  }
  for (const f of filters.analytics || []) {
    if (!f.column || f.value == null || f.value === '') continue;
    if (cellText(row, f.column) !== String(f.value).trim()) return false;
  }
  return true;
}

function dateBucket(dateKey, dateFrom, dateTo) {
  const from = dateFrom ? toDateKey(dateFrom) : null;
  const to = dateTo ? toDateKey(dateTo) : null;
  if (!dateKey) return 'turnover'; // keep undated in period turnover
  if (from && dateKey < from) return 'opening';
  if (to && dateKey > to) return 'after';
  return 'turnover';
}

/**
 * Accumulate opening nets + period turnovers per account key.
 */
function accumulateByAccount(postings, map, { dateFrom, dateTo, accountFilters, filters }) {
  const byKey = new Map();
  const displayVotes = new Map(); // key → Map<code, count>

  const touch = (rawCode) => {
    const key = normalizeAccountCode(rawCode);
    if (!key) return null;
    if (accountFilters?.length && !accountMatchesFilter(rawCode, accountFilters)) return null;
    if (!byKey.has(key)) byKey.set(key, emptyBucket());
    if (!displayVotes.has(key)) displayVotes.set(key, new Map());
    const votes = displayVotes.get(key);
    votes.set(rawCode, (votes.get(rawCode) || 0) + 1);
    return key;
  };

  for (const row of postings || []) {
    if (!passesFilters(row, filters)) continue;
    const sum = parseNumeric(row[map.amount]);
    if (!sum) continue;
    const dtRaw = map.accountDt ? cellText(row, map.accountDt) : '';
    const ctRaw = map.accountCt ? cellText(row, map.accountCt) : '';
    const dKey = map.date ? toDateKey(row[map.date]) : null;
    const bucketKind = dateBucket(dKey, dateFrom, dateTo);
    if (bucketKind === 'after') continue;

    const dtKey = dtRaw ? touch(dtRaw) : null;
    const ctKey = ctRaw ? touch(ctRaw) : null;

    if (bucketKind === 'opening') {
      if (dtKey) byKey.get(dtKey).openNet += sum;
      if (ctKey) byKey.get(ctKey).openNet -= sum;
    } else {
      if (dtKey) byKey.get(dtKey).turnoverDt += sum;
      if (ctKey) byKey.get(ctKey).turnoverCt += sum;
    }
  }

  const pickDisplay = (key) => {
    const votes = displayVotes.get(key);
    if (!votes?.size) return key;
    return [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))[0][0];
  };

  return { byKey, pickDisplay };
}

function rowFromBucket(displayCode, name, bucket) {
  const open = splitBalance(bucket.openNet);
  const close = splitBalance(bucket.openNet + bucket.turnoverDt - bucket.turnoverCt);
  return {
    Счет: displayCode,
    Наименование: name || '',
    'Сальдо нач. Дт': roundMoney(open.dt),
    'Сальдо нач. Кт': roundMoney(open.ct),
    'Оборот Дт': roundMoney(bucket.turnoverDt),
    'Оборот Кт': roundMoney(bucket.turnoverCt),
    'Сальдо кон. Дт': roundMoney(close.dt),
    'Сальдо кон. Кт': roundMoney(close.ct),
  };
}

const OSV_COLUMNS = [
  'Счет',
  'Наименование',
  'Сальдо нач. Дт',
  'Сальдо нач. Кт',
  'Оборот Дт',
  'Оборот Кт',
  'Сальдо кон. Дт',
  'Сальдо кон. Кт',
];

function sumOsvTotals(rows) {
  const t = {
    Счет: 'Итого',
    Наименование: '',
    'Сальдо нач. Дт': 0,
    'Сальдо нач. Кт': 0,
    'Оборот Дт': 0,
    'Оборот Кт': 0,
    'Сальдо кон. Дт': 0,
    'Сальдо кон. Кт': 0,
  };
  for (const r of rows) {
    t['Сальдо нач. Дт'] += r['Сальдо нач. Дт'];
    t['Сальдо нач. Кт'] += r['Сальдо нач. Кт'];
    t['Оборот Дт'] += r['Оборот Дт'];
    t['Оборот Кт'] += r['Оборот Кт'];
    t['Сальдо кон. Дт'] += r['Сальдо кон. Дт'];
    t['Сальдо кон. Кт'] += r['Сальдо кон. Кт'];
  }
  for (const k of Object.keys(t)) {
    if (typeof t[k] === 'number') t[k] = roundMoney(t[k]);
  }
  return t;
}

/**
 * ОСВ по всем / выбранным счетам.
 */
export function buildOsv({
  postings = [],
  columns,
  accountFilter = '',
  accountFilters = null,
  dateFrom = '',
  dateTo = '',
  mapping,
  coaLookup = null,
  includeCoaAccounts = false,
  filters = {},
}) {
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = resolveMapping(cols, mapping);
  if (!map.accountDt && !map.accountCt) {
    throw new Error('Не найдены колонки счетов Дт/Кт в таблице проводок');
  }
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const multi =
    accountFilters?.length
      ? accountFilters
      : accountFilter
        ? String(accountFilter)
            .split(/[,;\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

  const { byKey, pickDisplay } = accumulateByAccount(postings, map, {
    dateFrom,
    dateTo,
    accountFilters: multi,
    filters,
  });

  if (includeCoaAccounts && coaLookup) {
    for (const key of coaLookup.keys()) {
      if (multi?.length && !accountMatchesFilter(key, multi)) continue;
      if (!byKey.has(key)) byKey.set(key, emptyBucket());
    }
  }

  const data = Array.from(byKey.entries())
    .map(([key, bucket]) => {
      const coa = coaLookup?.get(key);
      const display = coa?.displayCode || pickDisplay(key);
      return rowFromBucket(display, coa?.name || '', bucket);
    })
    .sort((a, b) =>
      normalizeAccountCode(a.Счет).localeCompare(normalizeAccountCode(b.Счет), 'ru', {
        numeric: true,
      })
    );

  return {
    columns: OSV_COLUMNS,
    data,
    totals: sumOsvTotals(data),
  };
}

/**
 * Карточка счёта — входящий остаток, журнал за период, исходящий остаток.
 */
export function buildAccountCard({
  postings = [],
  columns,
  account,
  dateFrom = '',
  dateTo = '',
  mapping,
  filters = {},
  analyticsCol = '',
  analyticsValue = '',
}) {
  if (!account) throw new Error('Укажите счёт для карточки');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = resolveMapping(cols, mapping);
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const localFilters = {
    ...filters,
    analytics: [
      ...(filters.analytics || []),
      ...(analyticsCol && analyticsValue
        ? [{ column: analyticsCol, value: analyticsValue }]
        : []),
    ],
  };

  const analyticsCols = listAnalyticsColumns(cols);
  let openNet = 0;
  const periodRows = [];

  for (const row of postings || []) {
    if (!passesFilters(row, localFilters)) continue;
    const sum = parseNumeric(row[map.amount]);
    if (!sum) continue;
    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    const isDt = accountMatchesFilter(dt, [account]);
    const isCt = accountMatchesFilter(ct, [account]);
    if (!isDt && !isCt) continue;

    const dKey = map.date ? toDateKey(row[map.date]) : null;
    const kind = dateBucket(dKey, dateFrom, dateTo);
    if (kind === 'after') continue;

    if (kind === 'opening') {
      if (isDt) openNet += sum;
      if (isCt) openNet -= sum;
      continue;
    }

    const debit = isDt ? sum : 0;
    const credit = isCt ? sum : 0;
    const corr = isDt ? ct : dt;
    const out = {
      Дата: map.date ? (dKey || row[map.date]) : '',
      Документ: map.document ? cellText(row, map.document) : '',
      Содержание: map.content ? cellText(row, map.content) : '',
      'Корр. счёт': corr,
      'Сумма Дт': debit || '',
      'Сумма Кт': credit || '',
      _debit: debit,
      _credit: credit,
      _sort: dKey || '',
    };
    for (const c of analyticsCols) out[c] = row[c] ?? '';
    periodRows.push(out);
  }

  periodRows.sort((a, b) => String(a._sort).localeCompare(String(b._sort)));

  const open = splitBalance(openNet);
  let running = openNet;
  const data = [];

  data.push({
    Дата: '',
    Документ: '',
    Содержание: 'Входящий остаток',
    'Корр. счёт': '',
    'Сумма Дт': open.dt || '',
    'Сумма Кт': open.ct || '',
    'Текущее сальдо': formatSignedBalance(openNet),
    _kind: 'opening',
  });

  for (const r of periodRows) {
    running = roundMoney(running + r._debit - r._credit);
    const { _debit, _credit, _sort, ...rest } = r;
    data.push({
      ...rest,
      'Текущее сальдо': formatSignedBalance(running),
      _kind: 'tx',
    });
  }

  const close = splitBalance(running);
  data.push({
    Дата: '',
    Документ: '',
    Содержание: 'Исходящий остаток',
    'Корр. счёт': '',
    'Сумма Дт': close.dt || '',
    'Сумма Кт': close.ct || '',
    'Текущее сальдо': formatSignedBalance(running),
    _kind: 'closing',
  });

  const baseCols = [
    'Дата',
    'Документ',
    'Содержание',
    'Корр. счёт',
    ...analyticsCols,
    'Сумма Дт',
    'Сумма Кт',
    'Текущее сальдо',
  ];

  return {
    columns: baseCols,
    data: data.map(({ _kind, ...r }) => r),
    opening: { net: openNet, ...open },
    closing: { net: running, ...close },
  };
}

function formatSignedBalance(net) {
  const { dt, ct } = splitBalance(net);
  if (dt) return `${roundMoney(dt)} Дт`;
  if (ct) return `${roundMoney(ct)} Кт`;
  return '0';
}

/**
 * Анализ счёта — сальдо + обороты + разбивка по корр. счетам / аналитике.
 */
export function buildAccountAnalysis({
  postings = [],
  columns,
  account,
  dateFrom = '',
  dateTo = '',
  mapping,
  analyticsCol = '',
  filters = {},
}) {
  if (!account) throw new Error('Укажите счёт для анализа');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = resolveMapping(cols, mapping);
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  let openNet = 0;
  let turnoverDt = 0;
  let turnoverCt = 0;
  const byCorr = new Map();

  for (const row of postings || []) {
    if (!passesFilters(row, filters)) continue;
    const sum = parseNumeric(row[map.amount]);
    if (!sum) continue;
    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    const isDt = accountMatchesFilter(dt, [account]);
    const isCt = accountMatchesFilter(ct, [account]);
    if (!isDt && !isCt) continue;

    const dKey = map.date ? toDateKey(row[map.date]) : null;
    const kind = dateBucket(dKey, dateFrom, dateTo);
    if (kind === 'after') continue;

    if (kind === 'opening') {
      if (isDt) openNet += sum;
      if (isCt) openNet -= sum;
      continue;
    }

    if (isDt) turnoverDt += sum;
    if (isCt) turnoverCt += sum;

    const corr = isDt ? ct || '(без корреспонденции)' : dt || '(без корреспонденции)';
    const corrKey = normalizeAccountCode(corr) || corr;
    const analytics = analyticsCol ? cellText(row, analyticsCol) || '(пусто)' : '';
    const key = analyticsCol ? `${corrKey}|||${analytics}` : corrKey;
    if (!byCorr.has(key)) {
      byCorr.set(key, {
        'Корр. счёт': corr || corrKey,
        Аналитика: analytics,
        'Оборот Дт': 0,
        'Оборот Кт': 0,
      });
    }
    const b = byCorr.get(key);
    if (isDt) b['Оборот Дт'] += sum;
    if (isCt) b['Оборот Кт'] += sum;
  }

  const open = splitBalance(openNet);
  const closeNet = openNet + turnoverDt - turnoverCt;
  const close = splitBalance(closeNet);

  const summary = [
    {
      Показатель: 'Сальдо нач. Дт',
      Значение: open.dt,
    },
    { Показатель: 'Сальдо нач. Кт', Значение: open.ct },
    { Показатель: 'Оборот Дт', Значение: roundMoney(turnoverDt) },
    { Показатель: 'Оборот Кт', Значение: roundMoney(turnoverCt) },
    { Показатель: 'Сальдо кон. Дт', Значение: close.dt },
    { Показатель: 'Сальдо кон. Кт', Значение: close.ct },
  ];

  const breakdown = Array.from(byCorr.values())
    .map((r) => ({
      ...r,
      'Оборот Дт': roundMoney(r['Оборот Дт']),
      'Оборот Кт': roundMoney(r['Оборот Кт']),
    }))
    .sort((a, b) =>
      normalizeAccountCode(a['Корр. счёт']).localeCompare(
        normalizeAccountCode(b['Корр. счёт']),
        'ru',
        { numeric: true }
      )
    );

  const breakdownColumns = analyticsCol
    ? ['Корр. счёт', 'Аналитика', 'Оборот Дт', 'Оборот Кт']
    : ['Корр. счёт', 'Оборот Дт', 'Оборот Кт'];

  return {
    columns: ['Показатель', 'Значение'],
    data: summary,
    summary,
    breakdown,
    breakdownColumns,
    opening: { net: openNet, ...open },
    closing: { net: closeNet, ...close },
    turnoverDt: roundMoney(turnoverDt),
    turnoverCt: roundMoney(turnoverCt),
  };
}

/**
 * Анализ субконто — группировка по значению аналитики (+ счёт).
 * side: 'dt' | 'ct' | 'both' — which analytics columns / posting side to use.
 */
export function buildSubcontoAnalysis({
  postings = [],
  columns,
  analyticsCol,
  side = 'both',
  dateFrom = '',
  dateTo = '',
  mapping,
  filters = {},
  groupByAccount = true,
}) {
  if (!analyticsCol) throw new Error('Выберите колонку аналитики (вид субконто)');
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = resolveMapping(cols, mapping);
  if (!map.amount) throw new Error('Не найдена колонка суммы');

  const byKey = new Map();
  const ensure = (analytics, account) => {
    const key = `${analytics}|||${account}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        Аналитика: analytics,
        Счет: account,
        openNet: 0,
        turnoverDt: 0,
        turnoverCt: 0,
      });
    }
    return byKey.get(key);
  };

  for (const row of postings || []) {
    if (!passesFilters(row, filters)) continue;
    const sum = parseNumeric(row[map.amount]);
    if (!sum) continue;
    const analytics = cellText(row, analyticsCol);
    if (!analytics) continue;

    const dt = map.accountDt ? cellText(row, map.accountDt) : '';
    const ct = map.accountCt ? cellText(row, map.accountCt) : '';
    const dKey = map.date ? toDateKey(row[map.date]) : null;
    const kind = dateBucket(dKey, dateFrom, dateTo);
    if (kind === 'after') continue;

    const isDtCol = /^Дт:|Подразделение\s*Дт/i.test(analyticsCol);
    const isCtCol = /^Кт:|Подразделение\s*Кт/i.test(analyticsCol);
    let useDt = false;
    let useCt = false;
    if (isDtCol) {
      if (side === 'ct') continue;
      useDt = true;
    } else if (isCtCol) {
      if (side === 'dt') continue;
      useCt = true;
    } else {
      useDt = side === 'dt' || side === 'both';
      useCt = side === 'ct' || side === 'both';
    }

    const accountForGroup = (raw) =>
      groupByAccount ? normalizeAccountCode(raw) || raw || '(пусто)' : '';

    if (kind === 'opening') {
      if (useDt && dt) ensure(analytics, accountForGroup(dt)).openNet += sum;
      if (useCt && ct) ensure(analytics, accountForGroup(ct)).openNet -= sum;
      continue;
    }

    if (useDt && dt) ensure(analytics, accountForGroup(dt)).turnoverDt += sum;
    if (useCt && ct) ensure(analytics, accountForGroup(ct)).turnoverCt += sum;
  }

  // Merge if not grouping by account
  let entries = Array.from(byKey.values());
  if (!groupByAccount) {
    const merged = new Map();
    for (const e of entries) {
      if (!merged.has(e.Аналитика)) {
        merged.set(e.Аналитика, {
          Аналитика: e.Аналитика,
          Счет: '',
          openNet: 0,
          turnoverDt: 0,
          turnoverCt: 0,
        });
      }
      const m = merged.get(e.Аналитика);
      m.openNet += e.openNet;
      m.turnoverDt += e.turnoverDt;
      m.turnoverCt += e.turnoverCt;
    }
    entries = Array.from(merged.values());
  }

  const data = entries
    .map((e) => {
      const open = splitBalance(e.openNet);
      const close = splitBalance(e.openNet + e.turnoverDt - e.turnoverCt);
      return {
        Аналитика: e.Аналитика,
        ...(groupByAccount ? { Счет: e.Счет } : {}),
        'Сальдо нач. Дт': roundMoney(open.dt),
        'Сальдо нач. Кт': roundMoney(open.ct),
        'Оборот Дт': roundMoney(e.turnoverDt),
        'Оборот Кт': roundMoney(e.turnoverCt),
        'Сальдо кон. Дт': roundMoney(close.dt),
        'Сальдо кон. Кт': roundMoney(close.ct),
      };
    })
    .sort(
      (a, b) =>
        String(a.Аналитика).localeCompare(String(b.Аналитика), 'ru') ||
        String(a.Счет || '').localeCompare(String(b.Счет || ''), 'ru', { numeric: true })
    );

  const outColumns = groupByAccount
    ? [
        'Аналитика',
        'Счет',
        'Сальдо нач. Дт',
        'Сальдо нач. Кт',
        'Оборот Дт',
        'Оборот Кт',
        'Сальдо кон. Дт',
        'Сальдо кон. Кт',
      ]
    : [
        'Аналитика',
        'Сальдо нач. Дт',
        'Сальдо нач. Кт',
        'Оборот Дт',
        'Оборот Кт',
        'Сальдо кон. Дт',
        'Сальдо кон. Кт',
      ];

  return { columns: outColumns, data, totals: sumOsvLike(data, outColumns) };
}

function sumOsvLike(rows, columns) {
  const t = { Аналитика: 'Итого', Счет: '' };
  for (const c of columns) {
    if (c === 'Аналитика' || c === 'Счет') continue;
    t[c] = roundMoney(rows.reduce((s, r) => s + (Number(r[c]) || 0), 0));
  }
  return t;
}

/** Unique account codes found in postings (normalized display). */
export function listAccountsInPostings(postings = [], columns, mapping) {
  const cols = columns?.length ? columns : columnsFromData(postings);
  const map = resolveMapping(cols, mapping);
  const set = new Map();
  for (const row of postings || []) {
    for (const col of [map.accountDt, map.accountCt]) {
      if (!col) continue;
      const raw = cellText(row, col);
      if (!raw) continue;
      const key = normalizeAccountCode(raw);
      if (!set.has(key)) set.set(key, raw);
    }
  }
  return [...set.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'ru', { numeric: true }))
    .map(([, display]) => display);
}
