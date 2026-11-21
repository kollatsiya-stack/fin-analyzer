import { describe, expect, it } from 'vitest';
import { toDateKey } from './parse.js';
import {
  accountMatchesFilter,
  analyticsMatchesAccountSide,
  buildAccountAnalysis,
  buildAccountCard,
  buildOsv,
  buildSubcontoAnalysis,
  dateBucket,
  findPairedAnalyticsCol,
  formatSkippedDates,
  normalizeAccountCode,
  resolveSubcontoSideColumns,
  splitBalance,
} from './reports1c.js';

const postings = [
  // before period — opening
  { Дата: '2023-12-20', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 100, Организация: 'Альфа' },
  // period
  {
    Дата: '2024-01-05',
    'Счет Дт': '51',
    'Счет Кт': '62.1',
    Сумма: 1000,
    Организация: 'Альфа',
    'Дт: Контрагенты': 'Ромашка',
    'Кт: Контрагенты': '',
  },
  {
    Дата: '2024-01-10',
    'Счет Дт': '60.01',
    'Счет Кт': '51',
    Сумма: 200,
    Организация: 'Альфа',
    'Кт: Статьи затрат': 'Аренда',
    'Дт: Контрагенты': '',
    'Кт: Контрагенты': 'Поставщик',
  },
  {
    Дата: '2024-01-15',
    'Счет Дт': '51',
    'Счет Кт': '62.01',
    Сумма: 50,
    Организация: 'Бета',
    'Дт: Контрагенты': 'Василёк',
  },
  // after period
  { Дата: '2024-02-01', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 999, Организация: 'Альфа' },
];

describe('toDateKey / dateBucket', () => {
  it('parses DD.MM.YYYY with time and includes whole dateTo day', () => {
    expect(toDateKey('15.01.2024 18:30:00')).toBe('2024-01-15');
    expect(toDateKey('2024-01-31T23:59:59')).toBe('2024-01-31');
    expect(dateBucket('2024-01-31', '2024-01-01', '2024-01-31')).toBe('turnover');
    expect(dateBucket('2023-12-31', '2024-01-01', '2024-01-31')).toBe('opening');
    expect(dateBucket(null, '2024-01-01', '2024-01-31')).toBe('skip');
  });

  it('parses Excel serial as number and digit string (no 44927-01-01)', () => {
    expect(toDateKey(44927)).toBe('2023-01-01');
    expect(toDateKey('44927')).toBe('2023-01-01');
    expect(toDateKey('44927')).not.toBe('44927-01-01');
  });

  it('uses UTC Y-M-D for UTC-midnight Date (no TZ day shift)', () => {
    const utc = new Date(Date.UTC(2024, 0, 15, 0, 0, 0));
    expect(toDateKey(utc)).toBe('2024-01-15');
  });

  it('rejects garbage strings instead of Date.parse fallback', () => {
    expect(toDateKey('не дата')).toBe(null);
    expect(toDateKey('foo-bar')).toBe(null);
  });
});

describe('normalizeAccountCode / accountMatchesFilter', () => {
  it('treats 62.1 and 62.01 as the same', () => {
    expect(normalizeAccountCode('62.1')).toBe('62.01');
    expect(normalizeAccountCode('62.01')).toBe('62.01');
    expect(normalizeAccountCode('60.1')).toBe(normalizeAccountCode('60.01'));
  });

  it('does not match prefix 6 to 60', () => {
    expect(accountMatchesFilter('60', ['6'])).toBe(false);
    expect(accountMatchesFilter('60.01', ['60'])).toBe(true);
    expect(accountMatchesFilter('600', ['60'])).toBe(false);
  });
});

describe('splitBalance', () => {
  it('puts positive net on Dt', () => {
    expect(splitBalance(150)).toEqual({ dt: 150, ct: 0 });
    expect(splitBalance(-80)).toEqual({ dt: 0, ct: 80 });
  });
});

describe('buildOsv', () => {
  it('computes opening, turnover, closing with period bounds', () => {
    const { data, totals } = buildOsv({
      postings,
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    const a51 = data.find((r) => normalizeAccountCode(r.Счет) === '51');
    expect(a51['Сальдо нач. Дт']).toBe(100);
    expect(a51['Сальдо нач. Кт']).toBe(0);
    expect(a51['Оборот Дт']).toBe(1050);
    expect(a51['Оборот Кт']).toBe(200);
    expect(a51['Сальдо кон. Дт']).toBe(950);
    expect(a51['Сальдо кон. Кт']).toBe(0);

    const a62 = data.filter((r) => normalizeAccountCode(r.Счет) === '62.01');
    expect(a62).toHaveLength(1);
    expect(a62[0]['Сальдо нач. Кт']).toBe(100);
    expect(a62[0]['Оборот Кт']).toBe(1050);

    expect(totals['Оборот Дт']).toBe(totals['Оборот Кт']);
  });

  it('filters by organization', () => {
    const { data } = buildOsv({
      postings,
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      filters: { organizationCol: 'Организация', organization: 'Бета' },
    });
    const a51 = data.find((r) => normalizeAccountCode(r.Счет) === '51');
    expect(a51['Оборот Дт']).toBe(50);
    expect(a51['Сальдо нач. Дт']).toBe(0);
  });

  it('filters selected accounts', () => {
    const { data } = buildOsv({
      postings,
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      accountFilters: ['51'],
    });
    expect(data.every((r) => normalizeAccountCode(r.Счет) === '51')).toBe(true);
  });

  it('skips unrecognized dates when period is set and formats samples', () => {
    const mixed = [
      ...postings,
      { Дата: 'не дата', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 777, Организация: 'Альфа' },
    ];
    const { data, skippedDates } = buildOsv({
      postings: mixed,
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(skippedDates.length).toBe(1);
    expect(formatSkippedDates(skippedDates)).toContain('не дата');
    const a51 = data.find((r) => normalizeAccountCode(r.Счет) === '51');
    expect(a51['Оборот Дт']).toBe(1050);
  });

  it('includes DD.MM.YYYY datetime and Excel serial string on dateTo boundary', () => {
    const rows = [
      { Дата: '31.01.2024 23:15:00', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 10 },
      { Дата: '44927', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 7 }, // 2023-01-01 → opening if period 2024
    ];
    const { data } = buildOsv({
      postings: rows,
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    const a51 = data.find((r) => r.Счет === '51');
    expect(a51['Оборот Дт']).toBe(10);
    expect(a51['Сальдо нач. Дт']).toBe(7);
  });
});

describe('buildAccountCard', () => {
  it('shows opening, period txs with corr account, closing', () => {
    const { data, opening, closing } = buildAccountCard({
      postings,
      account: '51',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(opening.net).toBe(100);
    expect(data[0].Содержание).toBe('Входящий остаток');
    expect(data[data.length - 1].Содержание).toBe('Исходящий остаток');
    const txs = data.filter(
      (r) => r.Содержание !== 'Входящий остаток' && r.Содержание !== 'Исходящий остаток'
    );
    expect(txs.length).toBe(3);
    expect(txs[0]['Корр. счёт']).toBe('62.1');
    expect(closing.net).toBe(950);
  });

  it('matches account 60.1 as 60.01', () => {
    const { data } = buildAccountCard({
      postings,
      account: '60.1',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    const txs = data.filter(
      (r) => r.Содержание !== 'Входящий остаток' && r.Содержание !== 'Исходящий остаток'
    );
    expect(txs.length).toBe(1);
    expect(txs[0]['Сумма Дт']).toBe(200);
  });

  it('filters analytics on account side (Dt col + account on Dt)', () => {
    const { data } = buildAccountCard({
      postings,
      account: '51',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      analyticsCol: 'Дт: Контрагенты',
      analyticsValue: 'Ромашка',
    });
    const txs = data.filter(
      (r) => r.Содержание !== 'Входящий остаток' && r.Содержание !== 'Исходящий остаток'
    );
    expect(txs.length).toBe(1);
    expect(txs[0]['Сумма Дт']).toBe(1000);
  });

  it('uses paired Kt analytics when account is on Ct', () => {
    const { data } = buildAccountCard({
      postings,
      account: '51',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      analyticsCol: 'Дт: Контрагенты',
      analyticsValue: 'Поставщик',
    });
    const txs = data.filter(
      (r) => r.Содержание !== 'Входящий остаток' && r.Содержание !== 'Исходящий остаток'
    );
    // 51 on Ct of 60.01/51 posting; paired Кт: Контрагенты = Поставщик
    expect(txs.length).toBe(1);
    expect(txs[0]['Сумма Кт']).toBe(200);
  });
});

describe('buildAccountAnalysis', () => {
  it('summarizes and breaks down by corresponding account', () => {
    const { summary, breakdown, turnoverDt, turnoverCt } = buildAccountAnalysis({
      postings,
      account: '51',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(turnoverDt).toBe(1050);
    expect(turnoverCt).toBe(200);
    expect(summary.find((s) => s.Показатель === 'Сальдо нач. Дт').Значение).toBe(100);
    expect(breakdown.some((b) => normalizeAccountCode(b['Корр. счёт']) === '62.01')).toBe(true);
    expect(breakdown.find((b) => b['Корр. счёт'] === '60.01')['Оборот Кт']).toBe(200);
  });

  it('accepts 60.1 for analysis of 60.01', () => {
    const { turnoverDt } = buildAccountAnalysis({
      postings,
      account: '60.1',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
    });
    expect(turnoverDt).toBe(200);
  });
});

describe('analytics side helpers', () => {
  it('finds paired Dt/Kt columns', () => {
    const cols = ['Дт: Контрагенты', 'Кт: Контрагенты', 'Сумма'];
    expect(findPairedAnalyticsCol('Дт: Контрагенты', cols)).toBe('Кт: Контрагенты');
    expect(findPairedAnalyticsCol('Кт: Контрагенты', cols)).toBe('Дт: Контрагенты');
  });

  it('resolveSubcontoSideColumns uses pair when side=both', () => {
    const cols = ['Дт: Контрагенты', 'Кт: Контрагенты'];
    expect(resolveSubcontoSideColumns('Дт: Контрагенты', 'both', cols)).toEqual({
      dtCol: 'Дт: Контрагенты',
      ctCol: 'Кт: Контрагенты',
    });
    expect(resolveSubcontoSideColumns('Дт: Контрагенты', 'dt', cols)).toEqual({
      dtCol: 'Дт: Контрагенты',
      ctCol: null,
    });
    expect(resolveSubcontoSideColumns('Дт: Контрагенты', 'ct', cols)).toEqual({
      dtCol: null,
      ctCol: 'Кт: Контрагенты',
    });
  });

  it('analyticsMatchesAccountSide checks account side', () => {
    const row = {
      'Дт: Контрагенты': 'А',
      'Кт: Контрагенты': 'Б',
    };
    const cols = ['Дт: Контрагенты', 'Кт: Контрагенты'];
    expect(
      analyticsMatchesAccountSide(row, {
        analyticsCol: 'Дт: Контрагенты',
        analyticsValue: 'А',
        isDt: true,
        isCt: false,
        columns: cols,
      })
    ).toBe(true);
    expect(
      analyticsMatchesAccountSide(row, {
        analyticsCol: 'Дт: Контрагенты',
        analyticsValue: 'Б',
        isDt: false,
        isCt: true,
        columns: cols,
      })
    ).toBe(true);
    expect(
      analyticsMatchesAccountSide(row, {
        analyticsCol: 'Дт: Контрагенты',
        analyticsValue: 'А',
        isDt: false,
        isCt: true,
        columns: cols,
      })
    ).toBe(false);
  });
});

describe('buildSubcontoAnalysis', () => {
  it('groups by Dt analytics with balances', () => {
    const { data } = buildSubcontoAnalysis({
      postings,
      analyticsCol: 'Дт: Контрагенты',
      side: 'dt',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      groupByAccount: true,
    });
    const roma = data.find((r) => r.Аналитика === 'Ромашка');
    expect(roma['Оборот Дт']).toBe(1000);
    expect(roma.Счет).toBe('51');
  });

  it('side=both pulls paired Kt column', () => {
    const { data } = buildSubcontoAnalysis({
      postings,
      analyticsCol: 'Дт: Контрагенты',
      side: 'both',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      groupByAccount: true,
    });
    const supplier = data.find((r) => r.Аналитика === 'Поставщик');
    expect(supplier).toBeTruthy();
    expect(supplier['Оборот Кт']).toBe(200);
    expect(supplier.Счет).toBe('51');
  });

  it('groupByAccount=false merges accounts', () => {
    const { data, columns } = buildSubcontoAnalysis({
      postings,
      analyticsCol: 'Дт: Контрагенты',
      side: 'dt',
      dateFrom: '2024-01-01',
      dateTo: '2024-01-31',
      groupByAccount: false,
    });
    expect(columns).not.toContain('Счет');
    expect(data.every((r) => r.Счет === undefined)).toBe(true);
  });
});
