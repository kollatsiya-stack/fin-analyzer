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

/**
 * Parse date-like values to YYYY-MM-DD (local calendar day).
 * Supports Date, Excel serial, ISO, DD.MM.YYYY[, HH:mm[:ss]].
 */
export function toDateKey(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial day (UTC noon to avoid TZ day-shift)
    const epoch = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    const dt = new Date(epoch);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ISO / YYYY-MM-DD[ T/ ]HH:mm:ss
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD.MM.YYYY or DD/MM/YYYY[, HH:mm[:ss]]
  const dmy = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (dmy) {
    const y = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${y}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}
