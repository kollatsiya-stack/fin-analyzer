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
  mergeSources,
  rulesFromRows,
} from './etl.js';
import { pairsFromRows, readArrayBuffer } from './excel.js';
import { buildSpreadsheetBody, resultToValues } from './gsheets.js';

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

  it('matches on multiple exact criteria combined with AND', () => {
    const result = applyEnrichment({
      sourceData: [
        { inn: '7701', kpp: '7701001', name: 'A' },
        { inn: '7701', kpp: '7701002', name: 'B' },
      ],
      lookupData: [{ inn: '7701', kpp: '7701002', manager: 'Ivanov' }],
      config: {
        mode: 'vlookup',
        targetCol: 'Менеджер',
        sourceCol: 'manager',
        keys: [
          { k1: 'inn', k2: 'inn', logic: 'AND', exact: true },
          { k1: 'kpp', k2: 'kpp', logic: 'AND', exact: true },
        ],
      },
    });
    expect(result[0].Менеджер).toBe(null);
    expect(result[1].Менеджер).toBe('Ivanov');
  });

  it('pulls multiple columns from source 2 and suffixes colliding names', () => {
    const result = applyEnrichment({
      sourceData: [{ inn: '7701', Округ: 'старое' }],
      lookupData: [{ inn: '7701', manager: 'Ivanov', Округ: 'ЦФО' }],
      config: {
        mode: 'vlookup',
        pullCols: ['manager', 'Округ'],
        keys: [{ k1: 'inn', k2: 'inn', logic: 'AND', exact: true }],
      },
    });
    expect(result[0].manager).toBe('Ivanov');
    expect(result[0]['Округ']).toBe('старое');
    expect(result[0]['Округ (Источник 2)']).toBe('ЦФО');
  });

  it('keeps unmatched rows without analytics by default', () => {
    const result = applyEnrichment({
      sourceData: [{ inn: '7701' }, { inn: '0000' }],
      lookupData: [{ inn: '7701', manager: 'Ivanov' }],
      config: {
        mode: 'vlookup',
        pullCols: ['manager'],
        keys: [{ k1: 'inn', k2: 'inn', logic: 'AND', exact: true }],
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0].manager).toBe('Ivanov');
    expect(result[1].manager).toBe(null);
  });

  it('excludes unmatched rows when requested', () => {
    const result = applyEnrichment({
      sourceData: [{ inn: '7701' }, { inn: '0000' }],
      lookupData: [{ inn: '7701', manager: 'Ivanov' }],
      config: {
        mode: 'vlookup',
        pullCols: ['manager'],
        unmatchedAction: 'exclude',
        keys: [{ k1: 'inn', k2: 'inn', logic: 'AND', exact: true }],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].inn).toBe('7701');
    expect(result[0].manager).toBe('Ivanov');
  });

  it('excludes unmatched rows on the synonym scan path too', () => {
    const result = applyEnrichment({
      sourceData: [{ city: 'Мск' }, { city: 'Казань' }],
      lookupData: [{ town: 'г. Москва', region: 'ЦФО' }],
      config: {
        mode: 'vlookup',
        pullCols: ['region'],
        unmatchedAction: 'exclude',
        keys: [{ k1: 'city', k2: 'town', logic: 'AND', exact: false, synonyms: [{ a: 'Мск', b: 'г. Москва' }] }],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0].region).toBe('ЦФО');
  });

  it('matches when EITHER criterion holds using OR logic', () => {
    const result = applyEnrichment({
      sourceData: [{ inn: 'X', phone: '+7 999' }],
      lookupData: [{ inn: 'other', phone: '+7 999', tag: 'Найдено' }],
      config: {
        mode: 'vlookup',
        targetCol: 'Метка',
        sourceCol: 'tag',
        keys: [
          { k1: 'inn', k2: 'inn', logic: 'AND', exact: true },
          { k1: 'phone', k2: 'phone', logic: 'OR', exact: true },
        ],
      },
    });
    expect(result[0].Метка).toBe('Найдено');
  });

  it('matches differently-written values through a synonym dictionary', () => {
    const result = applyEnrichment({
      sourceData: [{ city: 'Мск' }, { city: 'СПб' }],
      lookupData: [
        { town: 'г. Москва', region: 'ЦФО' },
        { town: 'г. Санкт-Петербург', region: 'СЗФО' },
      ],
      config: {
        mode: 'vlookup',
        targetCol: 'Округ',
        sourceCol: 'region',
        keys: [
          {
            k1: 'city',
            k2: 'town',
            logic: 'AND',
            exact: false,
            synonyms: [
              { a: 'Мск', b: 'г. Москва' },
              { a: 'СПб', b: 'г. Санкт-Петербург' },
            ],
          },
        ],
      },
    });
    expect(result.map((r) => r.Округ)).toEqual(['ЦФО', 'СЗФО']);
  });

  it('does not match non-exact values missing from the dictionary', () => {
    const result = applyEnrichment({
      sourceData: [{ city: 'Мск' }],
      lookupData: [{ town: 'г. Москва', region: 'ЦФО' }],
      config: {
        mode: 'vlookup',
        targetCol: 'Округ',
        sourceCol: 'region',
        keys: [{ k1: 'city', k2: 'town', logic: 'AND', exact: false, synonyms: [] }],
      },
    });
    expect(result[0].Округ).toBe(null);
  });
});

describe('rulesFromRows', () => {
  it('maps rows to cascade rules with header heuristics', () => {
    const rules = rulesFromRows([
      { Колонка: 'name', Условие: 'содержит', Значение: 'Аренда', Тег: 'Аренда' },
      { Колонка: 'name', Условие: '=', Значение: 'Кофе', Тег: 'Прочее' },
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ col: 'name', op: 'содержит', val: 'Аренда', tag: 'Аренда' });
    expect(rules[1].op).toBe('равно');
  });

  it('falls back to positional columns and drops incomplete rows', () => {
    const rules = rulesFromRows([
      { A: 'col', B: '<>', C: 'x', D: 'Tag' },
      { A: 'col', B: '', C: '', D: '' },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ col: 'col', op: 'не равно', val: 'x', tag: 'Tag' });
  });
});

describe('google sheets export', () => {
  it('builds a header row followed by data rows, filling missing cells', () => {
    const values = resultToValues(
      [
        { Город: 'Мск', Сумма: 100 },
        { Город: 'СПб' },
      ],
      ['Город', 'Сумма']
    );
    expect(values).toEqual([
      ['Город', 'Сумма'],
      ['Мск', 100],
      ['СПб', ''],
    ]);
  });

  it('encodes numbers and strings into typed Sheets API cells', () => {
    const body = buildSpreadsheetBody('T', [
      ['Город', 'Сумма'],
      ['Мск', 100],
    ]);
    const rowData = body.sheets[0].data[0].rowData;
    expect(body.properties.title).toBe('T');
    expect(rowData[0].values[0].userEnteredValue).toEqual({ stringValue: 'Город' });
    expect(rowData[1].values[1].userEnteredValue).toEqual({ numberValue: 100 });
  });
});

describe('readArrayBuffer encoding', () => {
  it('decodes a BOM-less UTF-8 CSV with Cyrillic headers correctly', () => {
    const csv = 'Город,Округ\nМск,ЦФО\n';
    const bytes = new TextEncoder().encode(csv);
    const parsed = readArrayBuffer(bytes.buffer);
    expect(parsed.columns).toEqual(['Город', 'Округ']);
    expect(parsed.data[0]).toEqual({ Город: 'Мск', Округ: 'ЦФО' });
  });
});

describe('pairsFromRows', () => {
  it('reads two-column correspondence files into a→b pairs', () => {
    const pairs = pairsFromRows([
      { Исходное: 'Мск', Эталон: 'г. Москва' },
      { Исходное: '', Эталон: 'skip' },
    ]);
    expect(pairs).toEqual([{ a: 'Мск', b: 'г. Москва' }]);
  });
});

describe('mergeSources conflicts (1-to-many)', () => {
  const lookupConflict = [
    { org: 'Ромашка', manager: 'Мария' },
    { org: 'Ромашка', manager: 'Фаина' },
  ];

  it('reports a conflict and defaults to the first value', () => {
    const { data, conflicts } = mergeSources({
      sourceData: [{ org: 'Ромашка' }],
      lookupData: lookupConflict,
      keys: [{ k1: 'org', k2: 'org', exact: true }],
      pullCols: ['manager'],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].values).toEqual(['Мария', 'Фаина']);
    expect(conflicts[0].col).toBe('manager');
    expect(data[0].manager).toBe('Мария');
  });

  it('applies a chosen resolution value', () => {
    const first = mergeSources({
      sourceData: [{ org: 'Ромашка' }],
      lookupData: lookupConflict,
      keys: [{ k1: 'org', k2: 'org', exact: true }],
      pullCols: ['manager'],
    });
    const conflictId = first.conflicts[0].id;
    const resolved = mergeSources({
      sourceData: [{ org: 'Ромашка' }],
      lookupData: lookupConflict,
      keys: [{ k1: 'org', k2: 'org', exact: true }],
      pullCols: ['manager'],
      resolutions: { [conflictId]: 'Фаина' },
    });
    expect(resolved.data[0].manager).toBe('Фаина');
    expect(resolved.conflicts).toHaveLength(1);
  });

  it('does not flag a conflict when repeated matches agree', () => {
    const { data, conflicts } = mergeSources({
      sourceData: [{ org: 'Ромашка' }],
      lookupData: [
        { org: 'Ромашка', manager: 'Мария' },
        { org: 'Ромашка', manager: 'Мария' },
      ],
      keys: [{ k1: 'org', k2: 'org', exact: true }],
      pullCols: ['manager'],
    });
    expect(conflicts).toHaveLength(0);
    expect(data[0].manager).toBe('Мария');
  });

  it('resolves conflicts through a synonym criterion (differently-written keys)', () => {
    const { data, conflicts } = mergeSources({
      sourceData: [{ org: 'ООО Ромашка' }],
      lookupData: [
        { org: 'Ромашка ООО', manager: 'Мария' },
        { org: 'Ромашка ООО', manager: 'Фаина' },
      ],
      keys: [{ k1: 'org', k2: 'org', exact: false, synonyms: [{ a: 'ООО Ромашка', b: 'Ромашка ООО' }] }],
      pullCols: ['manager'],
    });
    expect(conflicts).toHaveLength(1);
    expect(data[0].manager).toBe('Мария');
  });
});

describe('allocation', () => {
  it('aggregates source-1 rows by criteria before distributing', () => {
    const result = applyAllocation({
      sourceData: [
        { dept: 'IT', Сумма: 60 },
        { dept: 'IT', Сумма: 40 },
      ],
      driverData: [
        { dept: 'IT', hours: 1, name: 'Ann' },
        { dept: 'IT', hours: 1, name: 'Bob' },
      ],
      config: {
        keys: [{ k1: 'dept', k2: 'dept' }],
        sumCol: 'Сумма',
        driverCol: 'hours',
        carryCols: ['name'],
        aggregateSource: true,
      },
    });
    // 60 + 40 = 100, поровну между Ann и Bob.
    expect(result).toHaveLength(2);
    expect(result.reduce((s, r) => s + r.Сумма, 0)).toBeCloseTo(100);
    expect(result.map((r) => r.Сумма).sort()).toEqual([50, 50]);
  });

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

  it('carries only the selected columns from source 2', () => {
    const result = applyAllocation({
      sourceData: [{ dept: 'IT', Сумма: 100 }],
      driverData: [
        { dept: 'IT', hours: 1, name: 'Ann', secret: 'X' },
        { dept: 'IT', hours: 1, name: 'Bob', secret: 'Y' },
      ],
      config: {
        keys: [{ k1: 'dept', k2: 'dept' }],
        sumCol: 'Сумма',
        driverCol: 'hours',
        carryCols: ['name'],
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Ann');
    expect(result[0].secret).toBeUndefined();
    expect('secret' in result[1]).toBe(false);
  });

  it('omits the formula column when addFormula is false', () => {
    const result = applyAllocation({
      sourceData: [{ dept: 'IT', Сумма: 100 }, { dept: 'HR', Сумма: 50 }],
      driverData: [{ dept: 'IT', hours: 1, name: 'Ann' }],
      config: {
        keys: [{ k1: 'dept', k2: 'dept' }],
        sumCol: 'Сумма',
        driverCol: 'hours',
        carryCols: ['name'],
        addFormula: false,
      },
    });
    expect(result.every((r) => !('_Формула_Расчета' in r))).toBe(true);
    // The unmatched HR row is still passed through.
    expect(result.find((r) => r.dept === 'HR')).toBeTruthy();
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
