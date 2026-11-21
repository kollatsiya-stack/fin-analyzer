import { typeLabel } from '../lib/sources.js';

/**
 * Dropdown to pick a table from the unified sources registry.
 * No free-text links — only already registered sources.
 */
export default function SourcePicker({
  sources = [],
  value,
  onChange,
  label = 'Таблица',
  placeholder = 'Выберите таблицу из реестра...',
  excludeIds = [],
  allowEmpty = true,
  className = '',
}) {
  const options = (sources || []).filter((s) => !excludeIds.includes(s.id));
  return (
    <div className={className}>
      {label && <label className="text-xs font-bold text-slate-500 mb-1 block">{label}</label>}
      <select
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value || null)}
        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-bold bg-white text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {allowEmpty && <option value="">{placeholder}</option>}
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {typeLabel(s.type)} · {s.data.length} стр. / {s.columns.length} кол.
          </option>
        ))}
      </select>
      {options.length === 0 && (
        <p className="text-xs text-amber-700 font-medium mt-1">
          Реестр пуст — загрузите источники на шаге 1.
        </p>
      )}
    </div>
  );
}
