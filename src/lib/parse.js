/** Normalize Russian / EU / US numeric strings into a finite number. */
export function parseNumeric(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;

  let str = String(val).trim().replace(/[\s\u00a0]/g, '');
  if (!str) return 0;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    str = str.replace(',', '.');
  } else if (hasDot) {
    const dotCount = (str.match(/\./g) || []).length;
    if (dotCount > 1) str = str.replace(/\./g, '');
  }

  const num = parseFloat(str);
  return Number.isFinite(num) ? num : 0;
}

export function deduplicateColumns(cols) {
  const counts = {};
  return cols.map((c) => {
    const name = c || 'Колонка';
    counts[name] = (counts[name] || 0) + 1;
    return counts[name] > 1 ? `${name}_${counts[name]}` : name;
  });
}

export function columnsFromData(data) {
  const seen = new Set();
  const cols = [];
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

export function cellText(row, col) {
  return String(row?.[col] ?? '').trim();
}

export function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function uniqueSorted(values) {
  return Array.from(new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))).sort();
}

export function matchCondition(cellVal, op, searchVal) {
  const cell = norm(cellVal);
  const search = norm(searchVal);
  switch (op) {
    case 'содержит':
      return cell.includes(search);
    case 'не содержит':
      return !cell.includes(search);
    case 'равно':
      return cell === search;
    case 'не равно':
      return cell !== search;
    default:
      return false;
  }
}

export function evalRuleGroup(row, rules) {
  const valid = rules.filter((r) => r.col && String(r.val ?? '').length > 0);
  if (valid.length === 0) return false;

  return valid.reduce((acc, rule, idx) => {
    const matched = matchCondition(row[rule.col], rule.op, rule.val);
    if (idx === 0) return matched;
    return rule.logic === 'OR' ? acc || matched : acc && matched;
  }, false);
}

export function compositeKey(row, fields) {
  return fields.map((f) => norm(row[f])).join('|||');
}

export function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
