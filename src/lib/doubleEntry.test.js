import { describe, expect, it } from 'vitest';
import {
  accountMatches,
  buildDrillDown,
  calculateDoubleEntrySum,
  getFilteredTransactions,
  normalizeJournal,
  sumMetric,
  toDateKey,
} from './doubleEntry.js';

const raw = [
  { Дата: '2024-01-05', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 1000, Организация: 'ООО Альфа', 'Статьи ДДС': 'Оплата аренды' },
  { Дата: '2024-01-10', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 500.25, Организация: 'ООО Альфа', 'Статьи ДДС': 'Выручка' },
  { Дата: '2024-01-15', 'Счет Дт': '60.01', 'Счет Кт': '51', Сумма: 200, Организация: 'ООО Бета', 'Статьи ДДС': 'Оплата аренды' },
  { Дата: '2023-12-20', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 50, Организация: 'ООО Альфа', 'Статьи ДДС': 'Выручка' },
  { Дата: '2024-02-01', 'Счет Дт': '51', 'Счет Кт': '62.01', Сумма: 999, Организация: 'ООО Альфа', 'Статьи ДДС': 'Выручка' },
];

const { transactions } = normalizeJournal(raw);

describe('helpers', () => {
  it('parses dates and account prefixes', () => {
    expect(toDateKey('05.01.2024')).toBe('2024-01-05');
    expect(accountMatches('51.01', ['51'])).toBe(true);
    expect(accountMatches('52', ['51'])).toBe(false);
  });
});

describe('getFilteredTransactions + calculateDoubleEntrySum', () => {
  const row = { accounts: ['51'] };
  const col = { startDate: '2024-01-01', endDate: '2024-01-31', filters: [] };

  it('turnover debit matches drill-down total to the kopeck', () => {
    const rule = { type: 'db', indicatorType: 'turnover', metricType: 'debit', expandAnalytic: 'no' };
    const cell = calculateDoubleEntrySum(transactions, row, col, null, rule);
    const filtered = getFilteredTransactions(transactions, row, col, null, rule);
    const { total } = sumMetric(filtered, row.accounts, 'debit');
    expect(cell).toBe(1500.25);
    expect(total).toBe(cell);
    expect(filtered).toHaveLength(2);
  });

  it('turnover credit for 51', () => {
    const rule = { type: 'db', indicatorType: 'turnover', metricType: 'credit', expandAnalytic: 'no' };
    const cell = calculateDoubleEntrySum(transactions, row, col, null, rule);
    expect(cell).toBe(200);
    const dd = buildDrillDown(transactions, row, col, null, rule);
    expect(dd.total).toBe(cell);
    expect(dd.transactions).toHaveLength(1);
  });

  it('active_balance = dr - cr', () => {
    const rule = { type: 'db', indicatorType: 'turnover', metricType: 'active_balance', expandAnalytic: 'no' };
    expect(calculateDoubleEntrySum(transactions, row, col, null, rule)).toBe(1300.25);
  });

  it('start_balance only before period', () => {
    const rule = { type: 'db', indicatorType: 'start_balance', metricType: 'debit', expandAnalytic: 'no' };
    expect(calculateDoubleEntrySum(transactions, row, col, null, rule)).toBe(50);
  });

  it('column filter by Организация', () => {
    const rule = { type: 'db', indicatorType: 'turnover', metricType: 'debit', expandAnalytic: 'no' };
    const colF = {
      ...col,
      filters: [{ columnName: 'Организация', selectedValues: ['ООО Альфа'] }],
    };
    const cell = calculateDoubleEntrySum(transactions, row, colF, null, rule);
    expect(cell).toBe(1500.25);
    const colBeta = {
      ...col,
      filters: [{ columnName: 'Организация', selectedValues: ['ООО Бета'] }],
    };
    // Beta only has credit on 51
    expect(calculateDoubleEntrySum(transactions, row, colBeta, null, rule)).toBe(0);
  });

  it('path filter for expanded analytic row', () => {
    const rule = { type: 'db', indicatorType: 'turnover', metricType: 'debit', expandAnalytic: 'debit' };
    const path = { 'Статьи ДДС': 'Оплата аренды' };
    const cell = calculateDoubleEntrySum(transactions, row, col, path, rule);
    const dd = buildDrillDown(transactions, row, col, path, rule, { rowName: 'ДС', colName: 'Янв' });
    expect(cell).toBe(1000);
    expect(dd.total).toBe(1000);
    expect(dd.transactions).toHaveLength(1);
  });

  it('blocks formula cells in drill-down', () => {
    const dd = buildDrillDown(transactions, row, col, null, { type: 'formula' });
    expect(dd.blocked).toBe(true);
    expect(dd.transactions).toHaveLength(0);
  });
});
