import { describe, expect, it } from 'vitest';
import {
  buildAccountAnalysis,
  buildAccountCard,
  buildOsv,
  buildSubcontoAnalysis,
} from './reports1c.js';

const postings = [
  { СчетДт: '41.01', СчетКт: '60.01', Сумма: 1000, Дата: '2024-05-01', 'Дт: Номенклатура': 'Товар А' },
  { СчетДт: '41.01', СчетКт: '60.01', Сумма: 500, Дата: '2024-05-02', 'Дт: Номенклатура': 'Товар Б' },
  { СчетДт: '62.01', СчетКт: '90.01', Сумма: 2000, Дата: '2024-05-03', 'Дт: Номенклатура': '' },
];

describe('buildOsv', () => {
  it('builds trial balance turnovers by account', () => {
    const { data, totals } = buildOsv({ postings });
    const a41 = data.find((r) => r.Счет === '41.01');
    expect(a41['Оборот Дт']).toBe(1500);
    expect(a41['Оборот Кт']).toBe(0);
    const a60 = data.find((r) => r.Счет === '60.01');
    expect(a60['Оборот Кт']).toBe(1500);
    expect(totals['Оборот Дт']).toBe(3500);
  });

  it('filters by account prefix', () => {
    const { data } = buildOsv({ postings, accountFilter: '41' });
    expect(data.every((r) => String(r.Счет).startsWith('41'))).toBe(true);
  });
});

describe('buildAccountCard', () => {
  it('lists postings for account with running balance', () => {
    const { data } = buildAccountCard({ postings, account: '41.01' });
    expect(data).toHaveLength(2);
    expect(data[1].Сальдо).toBe(1500);
  });
});

describe('buildAccountAnalysis', () => {
  it('groups by corresponding account', () => {
    const { data } = buildAccountAnalysis({ postings, account: '41.01' });
    expect(data[0]['Корр. счёт']).toBe('60.01');
    expect(data[0]['Оборот Дт']).toBe(1500);
  });
});

describe('buildSubcontoAnalysis', () => {
  it('groups by analytics column', () => {
    const { data } = buildSubcontoAnalysis({
      postings,
      analyticsCol: 'Дт: Номенклатура',
      side: 'dt',
    });
    expect(data.map((r) => r.Аналитика).sort()).toEqual(['Товар А', 'Товар Б']);
  });
});
