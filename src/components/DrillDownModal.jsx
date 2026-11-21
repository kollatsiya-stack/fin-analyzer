import { X } from 'lucide-react';
import { drillDownColumns } from '../lib/doubleEntry.js';

function fmt(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Modal: primary postings that formed a pivot cell (kopeck-accurate footer).
 */
export default function DrillDownModal({ payload, onClose }) {
  if (!payload) return null;

  const { meta = {}, blocked, reason, transactions = [], total, metricType } = payload;
  const pathLabel = payload.pathObj
    ? Object.entries(payload.pathObj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : '';
  const subtitle = [
    meta.rowName ? `Строка «${meta.rowName}»` : null,
    meta.colName ? `Столбец «${meta.colName}»` : null,
    pathLabel ? `Аналитика [${pathLabel}]` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const highlightDebit = metricType === 'debit' || metricType === 'active_balance';
  const highlightCredit = metricType === 'credit' || metricType === 'passive_balance';
  const { dynamic } = drillDownColumns(transactions);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-200">
          <div>
            <h3 className="text-lg font-black text-slate-800">Расшифровка ячейки</h3>
            {subtitle && <p className="text-xs text-slate-500 font-medium mt-1">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {blocked ? (
            <div className="text-center py-12 text-slate-500 font-medium">
              <div className="text-4xl mb-3 opacity-40">ƒ</div>
              {reason || 'Drill-down недоступен'}
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-slate-500 font-medium">
              <div className="text-4xl mb-3 opacity-40">∅</div>
              Проводок по данным фильтрам не найдено
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-auto max-h-[55vh]">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Дата</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Счет Дт</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Счет Кт</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-600">Сумма</th>
                    {dynamic.map((c) => (
                      <th key={c} className="px-3 py-2 text-left font-bold text-slate-600 whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, i) => (
                    <tr key={i} className="odd:bg-white even:bg-slate-50 border-t border-slate-100">
                      <td className="px-3 py-1.5 whitespace-nowrap">{tx.dateKey || String(tx.date || '')}</td>
                      <td
                        className={`px-3 py-1.5 font-mono ${
                          highlightDebit ? 'bg-emerald-50 text-emerald-900 font-bold' : ''
                        }`}
                      >
                        {tx.accountDebit}
                      </td>
                      <td
                        className={`px-3 py-1.5 font-mono ${
                          highlightCredit ? 'bg-sky-50 text-sky-900 font-bold' : ''
                        }`}
                      >
                        {tx.accountCredit}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold">{fmt(tx.amount)}</td>
                      {dynamic.map((c) => (
                        <td key={c} className="px-3 py-1.5 whitespace-nowrap">
                          {tx[c] == null || tx[c] === '' ? '—' : String(tx[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!blocked && (
          <div className="p-5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl">
            <div className="text-xs text-slate-500 font-medium">
              Проводок: <b className="text-slate-800">{transactions.length}</b>
              {payload.drSum != null && (
                <>
                  {' '}
                  · Дт {fmt(payload.drSum)} · Кт {fmt(payload.crSum)}
                </>
              )}
            </div>
            <div className="text-sm font-black text-indigo-800">
              Итого (проверка): {fmt(total)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
