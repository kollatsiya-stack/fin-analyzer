import { Copy, Play, Trash2 } from 'lucide-react';
import { TOOL_NAMES } from '../lib/transformRules.js';

/** List of saved named ETL rules with enable / reorder / run / edit / copy / delete. */
export default function RulesRegistry({
  rules = [],
  sources = [],
  onToggle,
  onMove,
  onEdit,
  onRun,
  onCopy,
  onDelete,
}) {
  const sorted = [...rules].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
  if (!sorted.length) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4 text-sm text-slate-500 font-medium">
        Пока нет сохранённых правил. Настройте трансформацию ниже и нажмите «Сохранить как правило».
      </div>
    );
  }

  const sourceName = (id) => sources.find((s) => s.id === id)?.name || '—';

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-sm">Реестр правил трансформаций ({sorted.length})</h3>
        <span className="text-xs text-slate-500 font-medium">Вкл / порядок / повторный прогон</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {sorted.map((rule, idx) => (
          <li
            key={rule.id}
            className={`p-3 flex flex-col lg:flex-row lg:items-center gap-3 ${
              rule.enabled ? 'bg-white' : 'bg-slate-50 opacity-70'
            }`}
          >
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => onToggle?.(rule.id)}
                className="accent-indigo-600 w-4 h-4"
                title="Включить / отключить"
              />
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => onMove?.(rule.id, 'up')}
                  className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 disabled:opacity-30 leading-none"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={idx === sorted.length - 1}
                  onClick={() => onMove?.(rule.id, 'down')}
                  className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 disabled:opacity-30 leading-none"
                >
                  ▼
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-slate-800 text-sm truncate">{rule.name}</div>
              <div className="text-xs text-slate-500 font-medium truncate">
                {TOOL_NAMES[rule.toolId] || `Инструмент ${rule.toolId}`} · осн:{' '}
                {sourceName(rule.bindings?.primarySourceId)}
                {rule.bindings?.lookupSourceId
                  ? ` · справ: ${sourceName(rule.bindings.lookupSourceId)}`
                  : ''}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onEdit?.(rule)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Изменить
              </button>
              <button
                type="button"
                onClick={() => onRun?.(rule)}
                disabled={!rule.enabled}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center gap-1"
              >
                <Play className="w-3.5 h-3.5" /> Прогнать
              </button>
              <button
                type="button"
                onClick={() => onCopy?.(rule)}
                className="text-xs font-bold px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                title="Копировать"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDelete?.(rule.id)}
                className="text-slate-400 hover:text-red-500 p-1.5"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
