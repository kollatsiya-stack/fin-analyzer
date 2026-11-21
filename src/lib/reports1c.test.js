import { describe, expect, it } from 'vitest';
import {
  buildAccountAnalysis,
  buildAccountCard,
  buildOsv,
  buildSubcontoAnalysis,
  normalizeAccountCode,
  splitBalance,
} from './reports1c.js';

const postings = [
  // before period — opening
  { Дата: '2023-12-20', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 100, Организация: 'Альфа' },
  // period
  { Дата: '2024-01-05', 'Счет Дт': '51', 'Счет Кт': '62.1', Сумма: 1000, Организация: 'Альфа', 'Дт: Контрагенты': 'Ромашка' },
  { Дата: '2024-01-10', 'Счет Дт': '60.01', 'Счет Кт': '51', Сумма: 200, Организация: 'Альфа', 'Кт: Статьи затрат': 'Аренда' },
  { Дата: '2024-01-15', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 50, Организация: 'Бета', 'Дт: Контрагенты': 'Василёк' },
  // after period
  { Дата: '2024-02-01', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 999, Организация: 'Альфа' },
];

describe('normalizeAccountCode', () => {
  it('treats 62.1 and 62.01 as the same', () => {
    expect(normalizeAccountCode('62.1')).toBe('62.01');
    expect(normalizeAccountCode('62.01')).toBe('62.01');
    expect(normalizeAccountCode('60.1')).toBe(normalizeAccountCode('60.01'));
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
    // opening: +100 Dt
    expect(a51['Сальдо нач. Дт']).toBe(100);
    expect(a51['Сальдо нач. Кт']).toBe(0);
    // turnover Dt: 1000+50=1050, Ct: 200
    expect(a51['Оборот Дт']).toBe(1050);
    expect(a51['Оборот Кт']).toBe(200);
    // closing net = 100+1050-200 = 950 Dt
    expect(a51['Сальдо кон. Дт']).toBe(950);
    expect(a51['Сальдо кон. Кт']).toBe(0);

    // 62.1 and 62.01 merged
    const a62 = data.filter((r) => normalizeAccountCode(r.Счет) === '62.01');
    expect(a62).toHaveLength(1);
    // opening Ct 100, turnover Ct 1000+50=1050 → closing Ct 1150
    expect(a62[0]['Сальдо нач. Кт']).toBe(100);
    expect(a62[0]['Оборот Кт']).toBe(1050);

    // totals: Dt turnovers == Ct turnovers
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
    expect(a51['Сальдо нач. Дт']).toBe(0); // opening was Альфа only
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
    const txs = data.filter((r) => r.Содержание !== 'Входящий остаток' && r.Содержание !== 'Исходящий остаток');
    expect(txs.length).toBe(3);
    expect(txs[0]['Корр. счёт']).toBe('62.1');
    expect(closing.net).toBe(950);
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
});
