import { describe, expect, it } from 'vitest';
import {
  duplicateRule,
  makeTransformRule,
  removeRule,
  reorderRules,
  sortRules,
  toggleRule,
  upsertRule,
} from './transformRules.js';

describe('transformRules', () => {
  it('creates named rule with bindings and config', () => {
    const rule = makeTransformRule({
      name: 'Аллокация ЦФО',
      toolId: 2,
      config: { sumCol: 'Сумма', driverCol: 'Доля' },
      bindings: { primarySourceId: 'a', lookupSourceId: 'b' },
      order: 1,
    });
    expect(rule.name).toBe('Аллокация ЦФО');
    expect(rule.toolId).toBe(2);
    expect(rule.enabled).toBe(true);
    expect(rule.bindings.primarySourceId).toBe('a');
    expect(rule.config.sumCol).toBe('Сумма');
  });

  it('upserts, toggles, duplicates and removes', () => {
    const a = makeTransformRule({ name: 'A', toolId: 1, order: 1 });
    const b = makeTransformRule({ name: 'B', toolId: 3, order: 2 });
    let rules = [a, b];
    rules = upsertRule(rules, { ...a, name: 'A2' });
    expect(rules.find((r) => r.id === a.id).name).toBe('A2');
    rules = toggleRule(rules, a.id);
    expect(rules.find((r) => r.id === a.id).enabled).toBe(false);
    const copy = duplicateRule(a, rules);
    expect(copy.name).toContain('копия');
    expect(copy.id).not.toBe(a.id);
    rules = removeRule([...rules, copy], copy.id);
    expect(rules.some((r) => r.id === copy.id)).toBe(false);
  });

  it('reorders by swapping ids', () => {
    const a = makeTransformRule({ name: 'A', toolId: 1, order: 1 });
    const b = makeTransformRule({ name: 'B', toolId: 2, order: 2 });
    const c = makeTransformRule({ name: 'C', toolId: 3, order: 3 });
    const next = reorderRules([a, b, c], a.id, c.id);
    expect(sortRules(next).map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });
});
