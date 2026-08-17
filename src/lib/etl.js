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

export function applyEnrichment({ sourceData, lookupData, config }) {
  const { mode, targetCol, sourceCol, keys, rules } = config;
  if (!targetCol) throw new Error('Укажите имя новой колонки');

  if (mode === 'vlookup') {
    if (!lookupData?.length) throw new Error('Загрузите справочник (Источник 2)');
    if (!sourceCol) throw new Error('Выберите колонку для извлечения из справочника');
    const validKeys = (keys || []).filter((k) => k.k1 && k.k2);
    if (!validKeys.length) throw new Error('Задайте ключи связи');

    const index = new Map();
    const k2Fields = validKeys.map((k) => k.k2);
    for (const row of lookupData) {
      const key = compositeKey(row, k2Fields);
      if (!index.has(key)) index.set(key, row);
    }
    const k1Fields = validKeys.map((k) => k.k1);

    return sourceData.map((r1) => {
      const match = index.get(compositeKey(r1, k1Fields));
      return { ...r1, [targetCol]: match ? match[sourceCol] : null };
    });
  }

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
  const { keys, sumCol, driverCol } = config;
  if (!driverData?.length) throw new Error('Загрузите базу распределения (Источник 2)');
  if (!sumCol || !driverCol) throw new Error('Укажите колонку суммы и драйвера');
  const validKeys = (keys || []).filter((k) => k.k1 && k.k2);
  if (!validKeys.length) throw new Error('Задайте хотя бы один критерий связи');

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
      finalData.push({ ...r1, _Формула_Расчета: 'База не найдена' });
      continue;
    }

    const origSum = parseNumeric(r1[sumCol]);
    const totalDriver = matches.reduce((s, m) => s + parseNumeric(m[driverCol]), 0);
    if (totalDriver === 0) {
      finalData.push({ ...r1, _Формула_Расчета: 'Сумма драйверов равна 0' });
      continue;
    }

    let allocatedTotal = 0;
    matches.forEach((m, idx) => {
      const driver = parseNumeric(m[driverCol]);
      let fraction = roundMoney(origSum * (driver / totalDriver));
      if (idx === matches.length - 1) fraction = roundMoney(origSum - allocatedTotal);
      allocatedTotal = roundMoney(allocatedTotal + fraction);

      const merged = { ...r1 };
      Object.entries(m).forEach(([k, v]) => {
        if (k === sumCol) return;
        if (k in merged && String(merged[k]) !== String(v)) merged[`${k}_база`] = v;
        else merged[k] = v;
      });
      merged[sumCol] = fraction;
      merged._Формула_Расчета = `${origSum} × (${driver} ÷ ${totalDriver}) = ${fraction}`;
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

export { columnsFromData };
