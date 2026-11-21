import { describe, expect, it } from 'vitest';
import {
  evaluateArgument,
  evaluateFormula,
  makeArgument,
  makeFormulaTemplate,
} from './formulas.js';
import { makeSource } from './sources.js';

const sales = makeSource({
  id: 'src_sales',
  name: 'Продажи',
  data: [
    { Контрагент: 'А', Сумма: 100, Регион: 'Север' },
    { Контрагент: 'Б', Сумма: 50, Регион: 'Юг' },
    { Контрагент: 'А', Сумма: 25, Регион: 'Север' },
  ],
});

describe('evaluateArgument', () => {
  it('sums resource with filters', () => {
    const arg = makeArgument({
      sourceId: 'src_sales',
      resourceCol: 'Сумма',
      filters: [{ logic: 'AND', field: 'Регион', op: 'равно', value: 'Север' }],
    });
    const { value } = evaluateArgument(arg, [sales]);
    expect(value).toBe(125);
  });
});

describe('evaluateFormula', () => {
  it('evaluates compound expression', () => {
    const arg1 = makeArgument({ id: 'a1', sourceId: 'src_sales', resourceCol: 'Сумма' });
    const tpl = makeFormulaTemplate({
      config: {
        arguments: [arg1],
        expression: {
          type: 'compound',
          items: [
            { type: 'argument', ref: 'a1' },
            { type: 'operator', value: '*' },
            { type: 'constant', value: 0.87 },
          ],
        },
      },
    });
    const { value } = evaluateFormula(tpl.config, [sales]);
    expect(value).toBe(152.25); // 175 * 0.87
  });
});
