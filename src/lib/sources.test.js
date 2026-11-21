import { describe, expect, it } from 'vitest';
import {
  makeSource,
  sourcesFromWorkbook,
  uniqueSourceName,
  upsertSource,
  getSource,
} from './sources.js';

describe('sources registry helpers', () => {
  it('makeSource fills columns from data', () => {
    const s = makeSource({
      name: 'Проводки_1С',
      type: 'excel',
      data: [{ A: 1, B: 2 }],
    });
    expect(s.id).toMatch(/^src_/);
    expect(s.columns).toEqual(['A', 'B']);
    expect(s.name).toBe('Проводки_1С');
  });

  it('uniqueSourceName appends counters', () => {
    const existing = [makeSource({ name: 'План_счетов', data: [] })];
    expect(uniqueSourceName(existing, 'План_счетов')).toBe('План_счетов (2)');
  });

  it('sourcesFromWorkbook registers each sheet', () => {
    const parsed = {
      sheets: ['Лист1', 'Лист2'],
      activeSheet: 'Лист1',
      allData: {
        Лист1: { data: [{ X: 1 }], columns: ['X'] },
        Лист2: { data: [{ Y: 2 }], columns: ['Y'] },
      },
    };
    const created = sourcesFromWorkbook(parsed, {
      type: 'gsheet',
      origin: 'https://docs.google.com/x',
      namePrefix: 'Бюджет',
    });
    expect(created).toHaveLength(2);
    expect(created[0].type).toBe('gsheet');
    expect(created[0].name).toContain('Бюджет');
    expect(created[1].columns).toEqual(['Y']);
  });

  it('upsertSource replaces by id', () => {
    const a = makeSource({ name: 'A', data: [{ v: 1 }], id: 'src_a' });
    const b = { ...a, name: 'A2', data: [{ v: 2 }] };
    const next = upsertSource([a], b);
    expect(next).toHaveLength(1);
    expect(getSource(next, 'src_a').name).toBe('A2');
  });
});
