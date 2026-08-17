import {
  cellText,
  columnsFromData,
  compositeKey,
  evalRuleGroup,
  matchCondition,
  norm,
  parseNumeric,
  roundMoney,
} from './parse.js';

/**
 * Build a matcher for a single join criterion.
 * - exact criteria compare normalized values directly;
 * - non-exact criteria match through a manual synonym dictionary (value in
 *   source 1 is declared equivalent to a value in source 2), while still
 *   accepting a literal match as a natural equivalence.
 */
function buildCriteria(validKeys) {
  return validKeys.map((k) => {
    const exact = k.exact !== false;
    const synMap = new Map();
    if (!exact) {
      for (const pair of k.synonyms || []) {
        const a = norm(pair.a);
        const b = norm(pair.b);
        if (!a || !b) continue;
        if (!synMap.has(a)) synMap.set(a, new Set());
        synMap.get(a).add(b);
      }
    }
    return { k1: k.k1, k2: k.k2, exact, logic: k.logic === 'OR' ? 'OR' : 'AND', synMap };
  });
}

function pairMatches(r1, r2, criteria) {
  return criteria.reduce((acc, c, idx) => {
    const a = norm(r1[c.k1]);
    const b = norm(r2[c.k2]);
    const matched = c.exact ? a === b : a === b || (c.synMap.get(a)?.has(b) ?? false);
    if (idx === 0) return matched;
    return c.logic === 'OR' ? acc || matched : acc && matched;
  }, false);
}

export function applyEnrichment({ sourceData, lookupData, config }) {
  const { mode, targetCol, sourceCol, pullCols, keys, rules, unmatchedAction } = config;

  if (mode === 'vlookup') {
    if (!lookupData?.length) throw new Error('Загрузите источник для объединения (Источник 2)');
    const validKeys = (keys || []).filter((k) => k.k1 && k.k2);
    if (!validKeys.length) throw new Error('Задайте критерии связи');

    // Columns to bring in from source 2. Support the new multi-column list and
    // the legacy single sourceCol/targetCol pair.
    const cleanPulls = (pullCols || []).filter(Boolean);
    const legacy = !cleanPulls.length && sourceCol;
    const pulls = legacy ? [sourceCol] : cleanPulls;
    if (!pulls.length) {
      throw new Error('Выберите хотя бы одну колонку для добавления из Источника 2');
    }

    const existingCols = new Set(sourceData.length ? Object.keys(sourceData[0]) : []);
    const outNames = pulls.map((col) => {
      if (legacy && targetCol) return targetCol;
      return existingCols.has(col) ? `${col} (Источник 2)` : col;
    });
    const assign = (r1, match) => {
      const out = { ...r1 };
      pulls.forEach((col, i) => {
        out[outNames[i]] = match ? match[col] : null;
      });
      return out;
    };

    // What to do with source-1 rows that have no match in source 2:
    // 'exclude' drops them, otherwise they are kept without the new analytics.
    const excludeUnmatched = unmatchedAction === 'exclude';

    const criteria = buildCriteria(validKeys);
    // Fast O(n+m) path when every criterion is an exact AND-match: an index by
    // composite key covers it. OR-logic or synonym dictionaries need a scan.
    const allExactAnd = criteria.every((c, i) => c.exact && (i === 0 || c.logic === 'AND'));

    let matchOf;
    if (allExactAnd) {
      const k2Fields = criteria.map((c) => c.k2);
      const k1Fields = criteria.map((c) => c.k1);
      const index = new Map();
      for (const row of lookupData) {
        const key = compositeKey(row, k2Fields);
        if (!index.has(key)) index.set(key, row);
      }
      matchOf = (r1) => index.get(compositeKey(r1, k1Fields));
    } else {
      matchOf = (r1) => lookupData.find((r2) => pairMatches(r1, r2, criteria));
    }

    const result = [];
    for (const r1 of sourceData) {
      const match = matchOf(r1);
      if (!match && excludeUnmatched) continue;
      result.push(assign(r1, match));
    }
    return result;
  }

  if (!targetCol) throw new Error('Укажите имя новой колонки');
  if (!rules?.length) throw new Error('Добавьте хотя бы одно правило в список');
  return sourceData.map((row) => {
    let newTag = null;
    for (const rule of rules) {
      if (!rule.col || !rule.val) continue;
      if (matchCondition(row[rule.col], rule.op, rule.val)) {
        newTag = rule.tag;
        break;
      }
    }
    return { ...row, [targetCol]: newTag ?? row[targetCol] ?? null };
  });
}

export function applyAllocation({ sourceData, driverData, config }) {
  const { keys, sumCol, driverCol, carryCols, addFormula = true } = config;
  if (!driverData?.length) throw new Error('Загрузите базу распределения (Источник 2)');
  if (!sumCol || !driverCol) throw new Error('Укажите колонку суммы и драйвера');
  const validKeys = (keys || []).filter((k) => k.k1 && k.k2);
  if (!validKeys.length) throw new Error('Задайте хотя бы один критерий связи');

  const FORMULA_COL = '_Формула_Расчета';
  // When carryCols is undefined we keep the legacy behavior of copying every
  // column from the driver row. When it is provided, only carry the selected
  // columns (an empty list carries nothing but the recomputed sum).
  const carryAll = carryCols === undefined;
  const carry = carryAll ? null : (carryCols || []).filter(Boolean);
  const withStatus = (row, status) => (addFormula ? { ...row, [FORMULA_COL]: status } : { ...row });

  const k2Fields = validKeys.map((k) => k.k2);
  const k1Fields = validKeys.map((k) => k.k1);
  const buckets = new Map();
  for (const row of driverData) {
    const key = compositeKey(row, k2Fields);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const finalData = [];
  for (const r1 of sourceData) {
    const matches = buckets.get(compositeKey(r1, k1Fields)) || [];
    if (!matches.length) {
      finalData.push(withStatus(r1, 'База не найдена'));
      continue;
    }

    const origSum = parseNumeric(r1[sumCol]);
    const totalDriver = matches.reduce((s, m) => s + parseNumeric(m[driverCol]), 0);
    if (totalDriver === 0) {
      finalData.push(withStatus(r1, 'Сумма драйверов равна 0'));
      continue;
    }

    let allocatedTotal = 0;
    matches.forEach((m, idx) => {
      const driver = parseNumeric(m[driverCol]);
      let fraction = roundMoney(origSum * (driver / totalDriver));
      if (idx === matches.length - 1) fraction = roundMoney(origSum - allocatedTotal);
      allocatedTotal = roundMoney(allocatedTotal + fraction);

      const merged = { ...r1 };
      const carryFields = carryAll ? Object.keys(m) : carry;
      carryFields.forEach((k) => {
        if (k === sumCol) return;
        const v = m[k];
        if (k in merged && String(merged[k]) !== String(v)) merged[`${k}_база`] = v;
        else merged[k] = v;
      });
      merged[sumCol] = fraction;
      if (addFormula) merged[FORMULA_COL] = `${origSum} × (${driver} ÷ ${totalDriver}) = ${fraction}`;
      finalData.push(merged);
    });
  }
  return finalData;
}

export function applyMapping({ sourceData, config }) {
  const { sourceCol, rules } = config;
  if (!sourceCol) throw new Error('Укажите исходную колонку для замены');
  const validMap = (rules || []).filter((r) => r.src && r.target);
  if (!validMap.length) throw new Error('Добавьте правила мэппинга');

  const mapDict = {};
  validMap.forEach((r) => {
    mapDict[norm(r.src)] = r.target;
  });

  return sourceData.map((row) => {
    const val = norm(row[sourceCol]);
    if (mapDict[val] != null) {
      return { ...row, [sourceCol]: mapDict[val], _Статус_Мэппинга: 'Заменено' };
    }
    return { ...row, _Статус_Мэппинга: 'Без изменений' };
  });
}

export function applyElimination({ sourceData, config }) {
  const { rules, action } = config;
  const validRules = (rules || []).filter((r) => r.col && String(r.val ?? '').length > 0);
  if (!validRules.length) throw new Error('Добавьте условия фильтрации');

  const finalData = [];
  for (const row of sourceData) {
    const matched = evalRuleGroup(row, validRules);
    if (matched) {
      if (action === 'soft') finalData.push({ ...row, _Статус_Элиминации: 'Исключено' });
    } else {
      finalData.push(row);
    }
  }
  return finalData;
}

export function applyAggregation({ sourceData, config }) {
  const { itemCol, sumCol, groupCols, groups } = config;
  if (!itemCol || !sumCol) throw new Error('Укажите колонки элементов и суммы');
  if (!groups?.length) throw new Error('Создайте хотя бы одну группу');

  const groupsMap = {};
  const itemsToReplace = new Set();
  groups.forEach((g) => {
    g.items.forEach((item) => {
      const key = norm(item);
      groupsMap[key] = g.name;
      itemsToReplace.add(key);
    });
  });

  const dimBuckets = {};
  const passThrough = [];

  sourceData.forEach((row) => {
    const itemVal = norm(row[itemCol]);
    if (!itemsToReplace.has(itemVal)) {
      passThrough.push({ ...row });
      return;
    }
    const dimKey = (groupCols || []).map((c) => row[c] ?? '').join('|||');
    const groupName = groupsMap[itemVal];
    const superKey = `${groupName}###${dimKey}`;
    if (!dimBuckets[superKey]) {
      dimBuckets[superKey] = { baseRow: { ...row }, sum: 0, count: 0 };
      dimBuckets[superKey].baseRow[itemCol] = groupName;
    }
    dimBuckets[superKey].sum = roundMoney(dimBuckets[superKey].sum + parseNumeric(row[sumCol]));
    dimBuckets[superKey].count += 1;
  });

  const aggregated = Object.values(dimBuckets).map((bucket) => {
    bucket.baseRow[sumCol] = bucket.sum;
    bucket.baseRow._Статус_Свертки = `Свернуто из ${bucket.count} эл.`;
    return bucket.baseRow;
  });

  return [...passThrough, ...aggregated];
}

export function applyAccrual({ sourceData, columns, config }) {
  const { rules, action, months, dateCol, dateVal, sumCol } = config;
  const validRules = (rules || []).filter((r) => r.col && String(r.val ?? '').length > 0);
  if (!validRules.length) throw new Error('Задайте условия фильтрации');

  const resolvedSumCol =
    sumCol ||
    (columns || []).find(
      (c) => String(c).toLowerCase().includes('сумма') || String(c).toLowerCase().includes('sum')
    );

  const finalData = [];
  sourceData.forEach((row) => {
    const matched = evalRuleGroup(row, validRules);
    if (!matched) {
      finalData.push(row);
      return;
    }

    if (action === 'split') {
      if (!resolvedSumCol) {
        finalData.push({ ...row, _Статус_Начисления: 'Колонка суммы не найдена' });
        return;
      }
      const m = Math.max(1, parseInt(months, 10) || 1);
      const origSum = parseNumeric(row[resolvedSumCol]);
      let allocated = 0;
      for (let i = 0; i < m; i += 1) {
        let part = roundMoney(origSum / m);
        if (i === m - 1) part = roundMoney(origSum - allocated);
        allocated = roundMoney(allocated + part);
        finalData.push({
          ...row,
          [resolvedSumCol]: part,
          _Статус_Начисления: `Месяц ${i + 1} из ${m}`,
        });
      }
    } else if (dateCol && dateVal) {
      finalData.push({ ...row, [dateCol]: dateVal, _Статус_Начисления: 'Дата сдвинута' });
    } else {
      finalData.push(row);
    }
  });
  return finalData;
}

export function applyPostings({ opsData, config }) {
  const { opsCol, virtRules } = config;
  if (!opsData?.length) throw new Error('Загрузите файл с операциями');
  if (!opsCol) throw new Error('Выберите колонку с операциями');

  const map = {};
  (virtRules || []).forEach((r) => {
    map[r.opName] = r;
  });

  return opsData.map((row) => {
    const val = cellText(row, opsCol);
    const rule = map[val];
    if (rule) return { ...row, Дебет: rule.dt, Кредит: rule.ct };
    return { ...row };
  });
}

export function applyRevaluation({ sourceData, config }) {
  const { sumCol, rate } = config;
  if (!sumCol || rate === '' || rate == null) {
    throw new Error('Укажите колонку с суммой и коэффициент');
  }
  const rateNum = parseNumeric(rate);
  return sourceData.map((row) => {
    const currentVal = parseNumeric(row[sumCol]);
    return {
      ...row,
      [sumCol]: roundMoney(currentVal * rateNum),
      _Статус_Переоценки: `Умножено на ${rateNum}`,
    };
  });
}

export function runRule(ruleId, ctx) {
  switch (ruleId) {
    case 1:
      return applyEnrichment({
        sourceData: ctx.source1,
        lookupData: ctx.source2,
        config: ctx.config,
      });
    case 2:
      return applyAllocation({
        sourceData: ctx.source1,
        driverData: ctx.source2,
        config: ctx.config,
      });
    case 3:
      return applyMapping({ sourceData: ctx.source1, config: ctx.config });
    case 4:
      return applyElimination({ sourceData: ctx.source1, config: ctx.config });
    case 5:
      return applyAggregation({ sourceData: ctx.source1, config: ctx.config });
    case 6:
      return applyAccrual({
        sourceData: ctx.source1,
        columns: ctx.columns,
        config: ctx.config,
      });
    case 7:
      return applyPostings({ opsData: ctx.opsData, config: ctx.config });
    case 8:
      return applyRevaluation({ sourceData: ctx.source1, config: ctx.config });
    default:
      throw new Error('Неизвестное правило');
  }
}

/**
 * Convert rows loaded from an Excel/CSV/Google Sheet into cascade enrichment
 * rules. Columns are matched by header heuristics with a positional fallback
 * (column, condition, value, tag).
 */
export function rulesFromRows(rows) {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  const pick = (subs, fallbackIdx) => {
    const found = keys.find((key) => subs.some((s) => key.toLowerCase().includes(s)));
    return found || keys[fallbackIdx];
  };
  const colKey = pick(['колон', 'если', 'поле', 'column'], 0);
  const opKey = pick(['услов', 'операт', 'op'], 1);
  const valKey = pick(['значен', 'текст', 'val'], 2);
  const tagKey = pick(['тег', 'резул', 'присво', 'tag'], 3);

  const normalizeOp = (raw) => {
    const s = String(raw ?? '').trim().toLowerCase();
    if (['содержит', 'не содержит', 'равно', 'не равно'].includes(s)) return s;
    if (s.includes('не сод')) return 'не содержит';
    if (s.includes('сод')) return 'содержит';
    if (s.includes('не рав') || s === '!=' || s === '<>') return 'не равно';
    if (s.includes('рав') || s === '=' || s === '==') return 'равно';
    return 'содержит';
  };

  return rows
    .map((row, i) => ({
      id: Date.now() + i,
      col: String(row[colKey] ?? '').trim(),
      op: normalizeOp(row[opKey]),
      val: String(row[valKey] ?? '').trim(),
      tag: String(row[tagKey] ?? '').trim(),
    }))
    .filter((r) => r.col && r.val && r.tag);
}

export { columnsFromData };
