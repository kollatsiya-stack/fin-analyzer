import { describe, expect, it } from 'vitest';
import { buildCoaIndex, detectSubcontoColumns, expandSubconto } from './subconto.js';

describe('detectSubcontoColumns', () => {
  it('finds typical 1C-style headers', () => {
    const post = [
      'СчетДт',
      'СчетКт',
      'Субконто1Дт',
      'Субконто2Дт',
      'Субконто3Дт',
      'Субконто1Кт',
      'Субконто2Кт',
      'Субконто3Кт',
      'ПодразделениеДт',
      'ПодразделениеКт',
    ];
    const coa = ['Счет', 'Родитель', 'Вид субконто 1', 'Вид субконто 2', 'Вид субконто 3'];
    const d = detectSubcontoColumns(post, coa);
    expect(d.postAccountDt).toBe('СчетДт');
    expect(d.postAccountCt).toBe('СчетКт');
    expect(d.postSubDt1).toBe('Субконто1Дт');
    expect(d.postSubCt2).toBe('Субконто2Кт');
    expect(d.coaAccount).toBe('Счет');
    expect(d.coaType1).toBe('Вид субконто 1');
  });
});

describe('buildCoaIndex hierarchy', () => {
  it('inherits types from parent when sub-account types are empty', () => {
    const coa = [
      { Счет: '41', Родитель: '', 'Вид1': 'Номенклатура', 'Вид2': 'Склад', 'Вид3': '' },
      { Счет: '41.01', Родитель: '41', 'Вид1': '', 'Вид2': '', 'Вид3': '' },
    ];
    const { resolveTypes } = buildCoaIndex(coa, {
      accountCol: 'Счет',
      parentCol: 'Родитель',
      typeCols: ['Вид1', 'Вид2', 'Вид3'],
    });
    expect(resolveTypes('41.01')).toEqual(['Номенклатура', 'Склад', '']);
  });

  it('falls back by stripping dotted segments without explicit parent', () => {
    const coa = [
      { Счет: '60', 'Вид1': 'Контрагенты', 'Вид2': 'Договоры', 'Вид3': '' },
      { Счет: '60.01', 'Вид1': '', 'Вид2': '', 'Вид3': '' },
    ];
    const { resolveTypes } = buildCoaIndex(coa, {
      accountCol: 'Счет',
      parentCol: '',
      typeCols: ['Вид1', 'Вид2', 'Вид3'],
    });
    expect(resolveTypes('60.01')).toEqual(['Контрагенты', 'Договоры', '']);
  });
});

describe('expandSubconto', () => {
  it('creates Дт/Кт analytics columns from COA types', () => {
    const postings = [
      {
        СчетДт: '41.01',
        СчетКт: '60.01',
        Субконто1Дт: 'Товар А',
        Субконто2Дт: 'Склад 1',
        Субконто3Дт: '',
        Субконто1Кт: 'ООО Ромашка',
        Субконто2Кт: 'Договор-1',
        Субконто3Кт: '',
        ПодразделениеДт: 'Опт',
        ПодразделениеКт: 'Закупки',
        Сумма: 1000,
      },
    ];
    const coa = [
      {
        Счет: '41',
        Родитель: '',
        'Вид субконто 1': 'Номенклатура',
        'Вид субконто 2': 'Склад',
        'Вид субконто 3': '',
      },
      {
        Счет: '41.01',
        Родитель: '41',
        'Вид субконто 1': '',
        'Вид субконто 2': '',
        'Вид субконто 3': '',
      },
      {
        Счет: '60',
        Родитель: '',
        'Вид субконто 1': 'Контрагенты',
        'Вид субконто 2': 'Договоры',
        'Вид субконто 3': '',
      },
      {
        Счет: '60.01',
        Родитель: '60',
        'Вид субконто 1': '',
        'Вид субконто 2': '',
        'Вид субконто 3': '',
      },
    ];

    const { data, addedColumns } = expandSubconto({ postings, coa });
    expect(data).toHaveLength(1);
    expect(data[0]['Дт: Номенклатура']).toBe('Товар А');
    expect(data[0]['Дт: Склад']).toBe('Склад 1');
    expect(data[0]['Кт: Контрагенты']).toBe('ООО Ромашка');
    expect(data[0]['Кт: Договоры']).toBe('Договор-1');
    expect(data[0]['Подразделение Дт']).toBe('Опт');
    expect(data[0]['Подразделение Кт']).toBe('Закупки');
    expect(data[0].Сумма).toBe(1000);
    expect(addedColumns).toEqual(
      expect.arrayContaining([
        'Дт: Номенклатура',
        'Дт: Склад',
        'Кт: Контрагенты',
        'Кт: Договоры',
        'Подразделение Дт',
        'Подразделение Кт',
      ])
    );
  });

  it('throws when accounts cannot be detected', () => {
    expect(() =>
      expandSubconto({
        postings: [{ Foo: 1 }],
        coa: [{ Счет: '41', 'Вид субконто 1': 'X' }],
      })
    ).toThrow(/счетов Дт\/Кт/i);
  });
});
