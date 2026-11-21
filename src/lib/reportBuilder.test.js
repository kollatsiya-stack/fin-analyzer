import { describe, expect, it } from 'vitest';
import { normalizeJournal } from './doubleEntry.js';
import {
  defaultCellRule,
  drillDownFromCell,
  makeReportTemplate,
  runUniversalReport,
  setCellRule,
} from './reportBuilder.js';

const raw = [
  { Дата: '2024-05-01', 'Счет Дт': '51', 'Счет Кт': '62', Сумма: 1000, Организация: 'Альфа' },
  { Дата: '2024-05-02', 'Счет Дт': '51', 'Счет Кт': '62', Сумма: 500, Организация: 'Альфа' },
  { Дата: '2024-05-03', 'Счет Дт': '60', 'Счет Кт': '51', Сумма: 200, Организация: 'Бета' },
];

describe('runUniversalReport pivot', () => {
  it('fills cells from double-entry and drill-down matches', () => {
    const { transactions } = normalizeJournal(raw);
    let tpl = makeReportTemplate({ name: 'ДС' });
    const rowId = tpl.structure.rows[0].id;
    const colId = tpl.structure.columns[0].id;
    tpl = {
      ...tpl,
      structure: {
        ...tpl.structure,
        rows: [{ id: rowId, name: 'Счёт 51', accounts: ['51'], expandBy: '', level: 0 }],
        columns: [
          {
            id: colId,
            name: 'Май',
            startDate: '2024-05-01',
            endDate: '2024-05-31',
            filters: [],
          },
        ],
        rules: {
          [rowId]: {
            [colId]: defaultCellRule({ metricType: 'active_balance' }),
          },
        },
      },
    };

    const result = runUniversalReport({ template: tpl, transactions });
    expect(result.rows).toHaveLength(1);
    const val = result.rows[0].values[colId];
    expect(val).toBe(1300); // 1500 dr - 200 cr

    const ctx = result.cells[`${result.rows[0].id}|${colId}`];
    expect(ctx.drillable).toBe(true);
    const dd = drillDownFromCell(transactions, ctx);
    expect(dd.blocked).toBe(false);
    expect(dd.total).toBe(val);
    expect(dd.transactions.length).toBe(3);
  });

  it('setCellRule updates nested map', () => {
    const tpl = makeReportTemplate();
    const rowId = tpl.structure.rows[0].id;
    const colId = tpl.structure.columns[0].id;
    const next = setCellRule(tpl.structure, rowId, colId, { metricType: 'credit' });
    expect(next.rules[rowId][colId].metricType).toBe('credit');
  });
});
