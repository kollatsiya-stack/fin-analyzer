import { describe, expect, it } from 'vitest';
import {
  excelFormulaToRowTotal,
  importStructureFromRows,
  makeReportTemplate,
  runUniversalReport,
} from './reportBuilder.js';
import { makeArgument, makeFormulaTemplate } from './formulas.js';
import { makeSource } from './sources.js';

describe('importStructureFromRows', () => {
  it('builds hierarchy from dotted codes', () => {
    const structure = importStructureFromRows([
      { Код: '01', Имя: 'Выручка' },
      { Код: '01.01', Имя: 'ВГО' },
    ]);
    expect(structure.rows[1].level).toBe(1);
  });
});

describe('excelFormulaToRowTotal', () => {
  it('maps cell refs to row numbers', () => {
    expect(excelFormulaToRowTotal('=B5+B6*0.87')).toBe('[5]+[6]*0.87');
  });
});

describe('runUniversalReport', () => {
  it('computes formula and row-total cells', () => {
    const source = makeSource({
      id: 's1',
      name: 'Base',
      data: [{ Сумма: 100 }, { Сумма: 50 }],
    });
    const formula = makeFormulaTemplate({
      id: 'f1',
      config: {
        arguments: [makeArgument({ id: 'a1', sourceId: 's1', resourceCol: 'Сумма' })],
        expression: { type: 'compound', items: [{ type: 'argument', ref: 'a1' }] },
      },
    });
    const template = makeReportTemplate({
      structure: {
        rows: [
          { number: 1, code: '01', name: 'Выручка', level: 0, type: 'calculation' },
          { number: 2, code: '02', name: 'Итого', level: 0, type: 'total' },
        ],
        columns: [{ code: 'VAL', name: 'Значение', type: 'static' }],
        cellRules: {
          'row:1,col:VAL': { type: 'formula', formulaId: 'f1' },
          'row:2,col:VAL': { type: 'rowTotal', expression: '[1]*2' },
        },
      },
    });
    const result = runUniversalReport({
      template,
      sources: [source],
      formulas: [formula],
    });
    expect(result.rows[0]['VAL::base']).toBe(150);
    expect(result.rows[1]['VAL::base']).toBe(300);
  });
});
