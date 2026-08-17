import { describe, expect, it } from 'vitest';
import { columnsFromData, deduplicateColumns, parseNumeric, evalRuleGroup } from './parse.js';
import {
  applyAccrual,
  applyAggregation,
  applyAllocation,
  applyElimination,
  applyEnrichment,
  applyMapping,
  applyPostings,
  applyRevaluation,
} from './etl.js';

describe('parseNumeric', () => {
  it('parses US and EU formats', () => {
    expect(parseNumeric(12.5)).toBe(12.5);
    expect(parseNumeric('1 234,56')).toBeCloseTo(1234.56);
    expect(parseNumeric('1.234,56')).toBeCloseTo(1234.56);
    expect(parseNumeric('1,234.56')).toBeCloseTo(1234.56);
    expect(parseNumeric('')).toBe(0);
    expect(parseNumeric('abc')).toBe(0);
  });
});

describe('columns', () => {
  it('deduplicates repeated headers', () => {
    expect(deduplicateColumns(['Сумма', 'Сумма', ''])).toEqual(['Сумма', 'Сумма_2', 'Колонка']);
  });

  it('collects union of keys in appearance order', () => {
    expect(columnsFromData([{ a: 1 }, { b: 2, a: 3 }])).toEqual(['a', 'b']);
  });
});

describe('enrichment', () => {
  it('looks up the first matching dictionary row', () => {
    const result = applyEnrichment({
      sourceData: [{ city: 'MSK', id: 1 }],
      lookupData: [
        { code: 'msk', project: 'A' },
        { code: 'msk', project: 'B' },
      ],
      config: {
        mode: 'vlookup',
        targetCol: 'Проект',
        sourceCol: 'project',
        keys: [{ k1: 'city', k2: 'code' }],
      },
    });
    expect(result[0].Проект).toBe('A');
  });

  it('applies cascade rules including not-equals', () => {
    const result = applyEnrichment({
      sourceData: [{ name: 'Аренда офиса' }, { name: 'Кофе' }],
      lookupData: [],
      config: {
        mode: 'rules',
        targetCol: 'Категория',
        rules: [
          { col: 'name', op: 'содержит', val: 'Аренда', tag: 'Аренда' },
          { col: 'name', op: 'не равно', val: 'Аренда офиса', tag: 'Прочее' },
        ],
      },
    });
    expect(result.map((r) => r.Категория)).toEqual(['Аренда', 'Прочее']);
  });
});

describe('allocation', () => {
  it('splits amount by driver and keeps remainder on the last row', () => {
    const result = applyAllocation({
      sourceData: [{ dept: 'IT', Сумма: 100 }],
      driverData: [
        { dept: 'IT', hours: 1, name: 'Ann' },
        { dept: 'IT', hours: 1, name: 'Bob' },
        { dept: 'IT', hours: 1, name: 'Cyd' },
      ],
      config: { keys: [{ k1: 'dept', k2: 'dept' }], sumCol: 'Сумма', driverCol: 'hours' },
    });
    expect(result).toHaveLength(3);
    expect(result.reduce((s, r) => s + r.Сумма, 0)).toBeCloseTo(100);
    expect(result.map((r) => r.name)).toEqual(['Ann', 'Bob', 'Cyd']);
  });

  it('does not overwrite colliding source columns', () => {
    const result = applyAllocation({
      sourceData: [{ dept: 'IT', Сумма: 10, name: 'Head' }],
      driverData: [{ dept: 'IT', hours: 1, name: 'Ann' }],
      config: { keys: [{ k1: 'dept', k2: 'dept' }], sumCol: 'Сумма', driverCol: 'hours' },
    });
    expect(result[0].name).toBe('Head');
    expect(result[0].name_база).toBe('Ann');
  });
});

describe('mapping / elimination / aggregation', () => {
  it('maps values and marks unchanged rows', () => {
    const result = applyMapping({
      sourceData: [{ article: 'Канцы' }, { article: 'Связь' }],
      config: { sourceCol: 'article', rules: [{ src: 'Канцы', target: 'Канцтовары' }] },
    });
    expect(result[0].article).toBe('Канцтовары');
    expect(result[1]._Статус_Мэппинга).toBe('Без изменений');
  });

  it('supports soft and hard elimination', () => {
    const data = [{ t: 'ВГО' }, { t: 'Ок' }];
    const rules = [{ col: 't', op: 'равно', val: 'ВГО', logic: 'AND' }];
    const soft = applyElimination({ sourceData: data, config: { rules, action: 'soft' } });
    const hard = applyElimination({ sourceData: data, config: { rules, action: 'hard' } });
    expect(soft).toHaveLength(2);
    expect(soft[0]._Статус_Элиминации).toBe('Исключено');
    expect(hard).toHaveLength(1);
    expect(hard[0].t).toBe('Ок');
  });

  it('aggregates selected items and keeps other rows', () => {
    const result = applyAggregation({
      sourceData: [
        { date: '2024-01', item: 'Бумага', Сумма: 10 },
        { date: '2024-01', item: 'Ручки', Сумма: 5 },
        { date: '2024-01', item: 'Аренда', Сумма: 100 },
      ],
      config: {
        itemCol: 'item',
        sumCol: 'Сумма',
        groupCols: ['date'],
        groups: [{ name: 'Канцтовары', items: ['Бумага', 'Ручки'] }],
      },
    });
    const grouped = result.find((r) => r.item === 'Канцтовары');
    expect(grouped.Сумма).toBe(15);
    expect(result.find((r) => r.item === 'Аренда').Сумма).toBe(100);
  });
});

describe('accrual / postings / revaluation', () => {
  it('splits remainder onto the last month', () => {
    const result = applyAccrual({
      sourceData: [{ type: 'РБП', Сумма: 100 }],
      columns: ['type', 'Сумма'],
      config: {
        rules: [{ col: 'type', op: 'равно', val: 'РБП' }],
        action: 'split',
        months: 3,
        sumCol: 'Сумма',
      },
    });
    expect(result).toHaveLength(3);
    expect(result.reduce((s, r) => s + r.Сумма, 0)).toBeCloseTo(100);
  });

  it('shifts date when requested', () => {
    const result = applyAccrual({
      sourceData: [{ type: 'РБП', date: '2024-01-01' }],
      columns: ['type', 'date'],
      config: {
        rules: [{ col: 'type', op: 'равно', val: 'РБП' }],
        action: 'shift',
        dateCol: 'date',
        dateVal: '2024-03-01',
      },
    });
    expect(result[0].date).toBe('2024-03-01');
  });

  it('fills debit/credit from the operations matrix', () => {
    const result = applyPostings({
      opsData: [{ op: 'Оплата' }, { op: 'Неизвестно' }],
      config: {
        opsCol: 'op',
        virtRules: [{ opName: 'Оплата', dt: '51', ct: '60' }],
      },
    });
    expect(result[0].Дебет).toBe('51');
    expect(result[1].Дебет).toBeUndefined();
  });

  it('multiplies the selected amount column', () => {
    const result = applyRevaluation({
      sourceData: [{ Сумма: '10,5' }],
      config: { sumCol: 'Сумма', rate: '1.2' },
    });
    expect(result[0].Сумма).toBeCloseTo(12.6);
  });
});

describe('evalRuleGroup', () => {
  it('combines AND/OR from the second condition', () => {
    const row = { a: 'x', b: 'y' };
    expect(
      evalRuleGroup(row, [
        { col: 'a', op: 'равно', val: 'x' },
        { logic: 'AND', col: 'b', op: 'равно', val: 'no' },
      ])
    ).toBe(false);
    expect(
      evalRuleGroup(row, [
        { col: 'a', op: 'равно', val: 'no' },
        { logic: 'OR', col: 'b', op: 'равно', val: 'y' },
      ])
    ).toBe(true);
  });
});
