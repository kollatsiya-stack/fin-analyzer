/** Named ETL transformation rules stored in the app registry (localStorage). */

export function createRuleId() {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @typedef {object} TransformRule
 * @property {string} id
 * @property {string} name
 * @property {number} toolId  1..8
 * @property {boolean} enabled
 * @property {number} order
 * @property {object} config   tool-specific params
 * @property {object} bindings { primarySourceId, lookupSourceId, opsSourceId, coaMatrixId, ... }
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export function makeTransformRule({
  name,
  toolId,
  config = {},
  bindings = {},
  enabled = true,
  order = 0,
  id,
} = {}) {
  const now = Date.now();
  return {
    id: id || createRuleId(),
    name: String(name || 'Правило').trim() || 'Правило',
    toolId: Number(toolId) || 1,
    enabled: enabled !== false,
    order: Number(order) || 0,
    config: { ...config },
    bindings: { ...bindings },
    createdAt: now,
    updatedAt: now,
  };
}

export function sortRules(rules) {
  return [...(rules || [])].sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'ru'));
}

export function reorderRules(rules, fromId, toId) {
  const list = sortRules(rules);
  const fromIdx = list.findIndex((r) => r.id === fromId);
  const toIdx = list.findIndex((r) => r.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return list;
  const [item] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, item);
  return list.map((r, i) => ({ ...r, order: i + 1, updatedAt: Date.now() }));
}

export function duplicateRule(rule, existing = []) {
  const copy = makeTransformRule({
    name: `${rule.name} (копия)`,
    toolId: rule.toolId,
    config: rule.config,
    bindings: rule.bindings,
    enabled: rule.enabled,
    order: (existing?.length || 0) + 1,
  });
  return copy;
}

export function toggleRule(rules, id) {
  return (rules || []).map((r) =>
    r.id === id ? { ...r, enabled: !r.enabled, updatedAt: Date.now() } : r
  );
}

export function upsertRule(rules, rule) {
  const list = rules || [];
  const idx = list.findIndex((r) => r.id === rule.id);
  const next = { ...rule, updatedAt: Date.now() };
  if (idx < 0) return [...list, next];
  const out = list.slice();
  out[idx] = next;
  return out;
}

export function removeRule(rules, id) {
  return (rules || []).filter((r) => r.id !== id);
}

const STORAGE_KEY = 'turbohub_transform_rules_v1';

export function loadRulesFromStorage() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRulesToStorage(rules) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules || []));
}

export const TOOL_NAMES = {
  1: 'Обогащение/объединение',
  2: 'Сплитование',
  3: 'Мэппинг',
  4: 'Элиминация',
  5: 'Агрегация',
  6: 'Временные сдвиги',
  7: 'Проводки',
  8: 'Переоценка',
};
