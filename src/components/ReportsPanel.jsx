import { useMemo, useState } from 'react';
import {
  Calculator,
  FileSpreadsheet,
  Layers,
  Play,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import DataPreview from './DataPreview.jsx';
import SourcePicker from './SourcePicker.jsx';
import DrillDownModal from './DrillDownModal.jsx';
import {
  buildAccountAnalysis,
  buildAccountCard,
  buildOsv,
  buildSubcontoAnalysis,
  detectPostingColumns,
  listAnalyticsColumns,
} from '../lib/reports1c.js';
import { normalizeJournal } from '../lib/doubleEntry.js';
import {
  emptyFormulaConfig,
  evaluateFormula,
  loadFormulasFromStorage,
  makeArgument,
  makeFormulaTemplate,
  saveFormulasToStorage,
  upsertFormula,
} from '../lib/formulas.js';
import {
  createColId,
  createRowId,
  defaultCellRule,
  drillDownFromCell,
  emptyReportStructure,
  getCellRule,
  importStructureFromRows,
  loadTemplatesFromStorage,
  makeReportTemplate,
  runUniversalReport,
  saveTemplatesToStorage,
  setCellRule,
  upsertTemplate,
} from '../lib/reportBuilder.js';
import { exportToExcel, readFileAsWorkbook } from '../lib/excel.js';

const TABS = [
  { id: 'std', label: 'Стандартные отчёты 1С', icon: FileSpreadsheet },
  { id: 'formulas', label: 'Шаблоны формул', icon: Calculator },
  { id: 'templates', label: 'Шаблоны отчётов', icon: Layers },
  { id: 'universal', label: 'Сводный отчёт', icon: Play },
];

const METRIC_OPTS = [
  ['debit', 'Оборот Дт'],
  ['credit', 'Оборот Кт'],
  ['active_balance', 'Активное сальдо (Дт−Кт)'],
  ['passive_balance', 'Пассивное сальдо (Кт−Дт)'],
];

const INDICATOR_OPTS = [
  ['turnover', 'Обороты за период'],
  ['start_balance', 'Остаток на начало'],
  ['end_balance', 'Остаток на конец'],
];

function fmt(n) {
  if (n == null || n === '' || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReportsPanel({ sources = [], onRegisterResult }) {
  const [tab, setTab] = useState('universal');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // --- Standard 1C ---
  const [stdSourceId, setStdSourceId] = useState(null);
  const [stdKind, setStdKind] = useState('osv');
  const [stdAccount, setStdAccount] = useState('');
  const [stdDateFrom, setStdDateFrom] = useState('');
  const [stdDateTo, setStdDateTo] = useState('');
  const [stdAnalyticsCol, setStdAnalyticsCol] = useState('');
  const [stdSide, setStdSide] = useState('dt');
  const [stdResult, setStdResult] = useState(null);

  const stdSource = sources.find((s) => s.id === stdSourceId) || null;
  const stdMap = useMemo(
    () => (stdSource ? detectPostingColumns(stdSource.columns) : {}),
    [stdSource]
  );
  const analyticsCols = useMemo(
    () => (stdSource ? listAnalyticsColumns(stdSource.columns) : []),
    [stdSource]
  );

  // --- Formulas ---
  const [formulas, setFormulas] = useState(() => loadFormulasFromStorage());
  const [editingFormula, setEditingFormula] = useState(null);
  const [formulaTest, setFormulaTest] = useState(null);

  // --- Templates (pivot) ---
  const [templates, setTemplates] = useState(() => loadTemplatesFromStorage());
  const [editingTpl, setEditingTpl] = useState(null);

  // --- Pivot / Universal ---
  const [uniSourceId, setUniSourceId] = useState(null);
  const [uniTplId, setUniTplId] = useState(null);
  const [uniGlobalFrom, setUniGlobalFrom] = useState('');
  const [uniGlobalTo, setUniGlobalTo] = useState('');
  const [uniResult, setUniResult] = useState(null);
  const [uniTx, setUniTx] = useState([]);
  const [drill, setDrill] = useState(null);

  const uniSource = sources.find((s) => s.id === uniSourceId) || null;
  const filterFieldOptions = useMemo(() => {
    if (!uniSource) return [];
    const skip = new Set(
      Object.values(detectPostingColumns(uniSource.columns || [])).filter(Boolean)
    );
    return (uniSource.columns || []).filter((c) => !skip.has(c));
  }, [uniSource]);

  const persistFormulas = (next) => {
    setFormulas(next);
    saveFormulasToStorage(next);
  };
  const persistTemplates = (next) => {
    setTemplates(next);
    saveTemplatesToStorage(next);
  };

  const runStd = () => {
    setError('');
    setSuccess('');
    try {
      if (!stdSource) throw new Error('Выберите таблицу проводок из реестра');
      let result;
      if (stdKind === 'osv' || stdKind === 'osv_filter') {
        result = buildOsv({
          postings: stdSource.data,
          columns: stdSource.columns,
          accountFilter: stdKind === 'osv_filter' ? stdAccount : '',
          dateFrom: stdDateFrom,
          dateTo: stdDateTo,
          mapping: stdMap,
        });
      } else if (stdKind === 'card') {
        result = buildAccountCard({
          postings: stdSource.data,
          columns: stdSource.columns,
          account: stdAccount,
          dateFrom: stdDateFrom,
          dateTo: stdDateTo,
          mapping: stdMap,
        });
      } else if (stdKind === 'analysis') {
        result = buildAccountAnalysis({
          postings: stdSource.data,
          columns: stdSource.columns,
          account: stdAccount,
          dateFrom: stdDateFrom,
          dateTo: stdDateTo,
          mapping: stdMap,
          analyticsCol: stdAnalyticsCol,
        });
      } else if (stdKind === 'subconto') {
        result = buildSubcontoAnalysis({
          postings: stdSource.data,
          columns: stdSource.columns,
          analyticsCol: stdAnalyticsCol,
          side: stdSide,
          dateFrom: stdDateFrom,
          dateTo: stdDateTo,
          mapping: stdMap,
        });
      }
      setStdResult(result);
      setSuccess(`Сформировано строк: ${result.data.length}`);
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const startNewFormula = () => {
    setEditingFormula(
      makeFormulaTemplate({
        config: {
          ...emptyFormulaConfig(),
          arguments: [makeArgument({ name: 'Аргумент 1' })],
          expression: { type: 'compound', items: [{ type: 'argument', ref: '' }] },
        },
      })
    );
    setFormulaTest(null);
  };

  const saveFormula = () => {
    if (!editingFormula?.name) return;
    const cfg = editingFormula.config;
    if (cfg.arguments?.length === 1 && cfg.expression?.items?.length) {
      cfg.expression.items = cfg.expression.items.map((it) =>
        it.type === 'argument' && !it.ref ? { ...it, ref: cfg.arguments[0].id } : it
      );
    }
    persistFormulas(upsertFormula(formulas, { ...editingFormula, config: cfg }));
    setSuccess(`Формула «${editingFormula.name}» сохранена`);
    setEditingFormula(null);
  };

  const testFormula = () => {
    setError('');
    try {
      const result = evaluateFormula(editingFormula.config, sources, formulas);
      setFormulaTest(result);
      setSuccess(`Тест: ${result.value}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const startNewTemplate = () => {
    setEditingTpl(makeReportTemplate({ structure: emptyReportStructure() }));
  };

  const saveTemplate = () => {
    if (!editingTpl?.name) return;
    persistTemplates(upsertTemplate(templates, editingTpl));
    setSuccess(`Шаблон «${editingTpl.name}» сохранён`);
    setEditingTpl(null);
  };

  const importTplStructure = async (file) => {
    if (!file || !editingTpl) return;
    try {
      const parsed = await readFileAsWorkbook(file);
      const structure = importStructureFromRows(parsed.data);
      setEditingTpl({ ...editingTpl, structure });
      setSuccess(`Импортировано строк: ${structure.rows.length}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const patchTpl = (fn) => setEditingTpl((prev) => ({ ...prev, structure: fn(prev.structure) }));

  const runPivot = () => {
    setError('');
    setDrill(null);
    try {
      if (!uniSource) throw new Error('Выберите журнал проводок из реестра');
      const tpl = templates.find((t) => t.id === uniTplId);
      if (!tpl) throw new Error('Выберите шаблон отчёта');
      const { transactions } = normalizeJournal(uniSource.data, uniSource.columns);
      setUniTx(transactions);
      const result = runUniversalReport({
        template: tpl,
        transactions,
        sources,
        formulas,
        globalStartDate: uniGlobalFrom,
        globalEndDate: uniGlobalTo,
      });
      setUniResult(result);
      setSuccess(
        `Отчёт: ${result.rows.length} строк × ${result.columns.length} столбцов` +
          (result.errors.length ? `, ошибок: ${result.errors.length}` : '')
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const openDrill = (displayRow, col) => {
    if (!uniResult) return;
    const ctx = uniResult.cells[`${displayRow.id}|${col.id}`];
    if (!ctx) return;
    if (ctx.rule?.type === 'formula') {
      setDrill(
        drillDownFromCell(uniTx, { ...ctx, drillable: false })
      );
      return;
    }
    const payload = drillDownFromCell(uniTx, ctx);
    // Prove kopeck match
    if (payload && !payload.blocked && ctx.value != null && payload.total !== ctx.value) {
      setError(
        `Расхождение drill-down: ячейка ${fmt(ctx.value)} ≠ детализация ${fmt(payload.total)}`
      );
    }
    setDrill(payload);
  };

  const editingRuleFor = (rowId, colId) =>
    editingTpl ? getCellRule(editingTpl.structure, rowId, colId) : defaultCellRule();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800">Шаг 4. Отчёты</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Сводный отчёт: ячейка = строка (счета) × столбец (период/фильтры). Клик — расшифровка до проводок.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-green-50 text-green-700 rounded-xl border border-green-200 font-bold text-sm">{success}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm border transition ${
              tab === t.id
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
            }`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* ===== Standard 1C ===== */}
      {tab === 'std' && (
        <div className="space-y-4">
          <SourcePicker sources={sources} value={stdSourceId} onChange={setStdSourceId} label="Таблица проводок (из реестра)" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Тип отчёта</label>
              <select value={stdKind} onChange={(e) => setStdKind(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white">
                <option value="osv">ОСВ по всем счетам</option>
                <option value="osv_filter">ОСВ по выбранным счетам</option>
                <option value="card">Карточка счёта</option>
                <option value="analysis">Анализ счёта</option>
                <option value="subconto">Анализ субконто</option>
              </select>
            </div>
            {stdKind !== 'osv' && stdKind !== 'subconto' && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Счёт (префикс)</label>
                <input value={stdAccount} onChange={(e) => setStdAccount(e.target.value)} placeholder="41 или 41.01" className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold" />
              </div>
            )}
            {(stdKind === 'analysis' || stdKind === 'subconto') && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Колонка аналитики</label>
                <select value={stdAnalyticsCol} onChange={(e) => setStdAnalyticsCol(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm bg-white font-bold">
                  <option value="">—</option>
                  {analyticsCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {stdKind === 'subconto' && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Сторона</label>
                <select value={stdSide} onChange={(e) => setStdSide(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm bg-white font-bold">
                  <option value="dt">Дебет</option>
                  <option value="ct">Кредит</option>
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Период с</label>
              <input type="date" value={stdDateFrom} onChange={(e) => setStdDateFrom(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Период по</label>
              <input type="date" value={stdDateTo} onChange={(e) => setStdDateTo(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm" />
            </div>
          </div>
          <button type="button" onClick={runStd} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 inline-flex items-center gap-2">
            <Play className="w-4 h-4" /> Сформировать
          </button>
          {stdResult && (
            <div className="space-y-3">
              <DataPreview data={stdResult.totals ? [...stdResult.data, stdResult.totals] : stdResult.data} columns={stdResult.columns} maxRows={100} />
              <div className="flex gap-2">
                <button type="button" onClick={() => exportToExcel(stdResult.totals ? [...stdResult.data, stdResult.totals] : stdResult.data, 'OSV.xlsx')} className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm">Excel</button>
                {onRegisterResult && (
                  <button type="button" onClick={() => onRegisterResult(stdResult.totals ? [...stdResult.data, stdResult.totals] : stdResult.data, `Отчёт_${stdKind}`)} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm">В реестр</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Formulas (kept for formula cells) ===== */}
      {tab === 'formulas' && (
        <div className="space-y-4">
          {!editingFormula ? (
            <>
              <button type="button" onClick={startNewFormula} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Новая формула
              </button>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {formulas.filter((f) => !f.isDeleted).map((f) => (
                  <li key={f.id} className="p-3 flex justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm">{f.name}</div>
                      <div className="text-xs text-slate-500">{f.group}</div>
                    </div>
                    <button type="button" onClick={() => setEditingFormula(f)} className="text-xs font-bold px-3 py-1.5 bg-slate-100 rounded-lg">Изменить</button>
                  </li>
                ))}
                {!formulas.filter((f) => !f.isDeleted).length && (
                  <li className="p-4 text-sm text-slate-500">Нет формул. Нужны только для ячеек type=formula.</li>
                )}
              </ul>
            </>
          ) : (
            <div className="space-y-3 border border-slate-200 rounded-xl p-4">
              <input value={editingFormula.name} onChange={(e) => setEditingFormula({ ...editingFormula, name: e.target.value })} className="w-full border rounded-lg p-2 font-bold" placeholder="Имя формулы" />
              {(editingFormula.config.arguments || []).map((arg) => (
                <div key={arg.id} className="grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg">
                  <input value={arg.name} onChange={(e) => setEditingFormula({
                    ...editingFormula,
                    config: {
                      ...editingFormula.config,
                      arguments: editingFormula.config.arguments.map((a) => (a.id === arg.id ? { ...a, name: e.target.value } : a)),
                    },
                  })} className="border rounded p-2 text-sm" placeholder="Имя аргумента" />
                  <SourcePicker sources={sources} value={arg.sourceId} onChange={(id) => setEditingFormula({
                    ...editingFormula,
                    config: {
                      ...editingFormula.config,
                      arguments: editingFormula.config.arguments.map((a) => (a.id === arg.id ? { ...a, sourceId: id } : a)),
                    },
                  })} label="Источник" />
                  <select value={arg.resourceCol} onChange={(e) => setEditingFormula({
                    ...editingFormula,
                    config: {
                      ...editingFormula.config,
                      arguments: editingFormula.config.arguments.map((a) => (a.id === arg.id ? { ...a, resourceCol: e.target.value } : a)),
                    },
                  })} className="border rounded p-2 text-sm bg-white">
                    <option value="">Колонка-ресурс</option>
                    {(sources.find((s) => s.id === arg.sourceId)?.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
              {formulaTest && <div className="text-sm font-bold text-green-800">Результат теста: {formulaTest.value}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={testFormula} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm">Тест</button>
                <button type="button" onClick={saveFormula} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-1"><Save className="w-4 h-4" /> Сохранить</button>
                <button type="button" onClick={() => setEditingFormula(null)} className="border px-4 py-2 rounded-lg font-bold text-sm">Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Templates: rows × columns × cell rules ===== */}
      {tab === 'templates' && (
        <div className="space-y-4">
          {!editingTpl ? (
            <>
              <button type="button" onClick={startNewTemplate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Новый шаблон
              </button>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {templates.filter((t) => !t.isDeleted).map((t) => (
                  <li key={t.id} className="p-3 flex justify-between gap-2 items-center">
                    <div>
                      <div className="font-bold text-sm">{t.name}</div>
                      <div className="text-xs text-slate-500">
                        {t.structure?.rows?.length || 0} строк · {t.structure?.columns?.length || 0} столбцов
                      </div>
                    </div>
                    <button type="button" onClick={() => setEditingTpl(t)} className="text-xs font-bold px-3 py-1.5 bg-slate-100 rounded-lg">Изменить</button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="space-y-5">
              <input
                value={editingTpl.name}
                onChange={(e) => setEditingTpl({ ...editingTpl, name: e.target.value })}
                className="w-full border rounded-lg p-2.5 font-bold text-lg"
                placeholder="Название шаблона"
              />
              <label className="inline-flex items-center gap-2 text-sm font-bold text-indigo-700 cursor-pointer">
                <Plus className="w-4 h-4" /> Импорт строк из Excel
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { importTplStructure(e.target.files?.[0]); e.target.value = ''; }} />
              </label>

              {/* Rows */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 font-bold text-sm text-slate-800 flex justify-between">
                  <span>Строки (показатели + счета)</span>
                  <button
                    type="button"
                    className="text-indigo-600 text-xs font-bold"
                    onClick={() => patchTpl((s) => {
                      const id = createRowId();
                      const colIds = (s.columns || []).map((c) => c.id);
                      const rules = { ...s.rules, [id]: {} };
                      colIds.forEach((cid) => { rules[id][cid] = defaultCellRule(); });
                      return {
                        ...s,
                        rows: [...(s.rows || []), { id, name: 'Новый показатель', accounts: ['51'], expandBy: '', level: 0 }],
                        rules,
                      };
                    })}
                  >
                    + Строка
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {(editingTpl.structure.rows || []).map((row) => (
                    <div key={row.id} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
                      <input
                        value={row.name}
                        onChange={(e) => patchTpl((s) => ({
                          ...s,
                          rows: s.rows.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)),
                        }))}
                        className="border rounded p-2 text-sm font-bold"
                        placeholder="Название"
                      />
                      <input
                        value={(row.accounts || []).join(', ')}
                        onChange={(e) => patchTpl((s) => ({
                          ...s,
                          rows: s.rows.map((r) =>
                            r.id === row.id
                              ? {
                                  ...r,
                                  accounts: e.target.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
                                }
                              : r
                          ),
                        }))}
                        className="border rounded p-2 text-sm font-mono"
                        placeholder="Счета: 50, 51"
                      />
                      <input
                        value={row.expandBy || ''}
                        onChange={(e) => patchTpl((s) => ({
                          ...s,
                          rows: s.rows.map((r) => (r.id === row.id ? { ...r, expandBy: e.target.value } : r)),
                        }))}
                        className="border rounded p-2 text-sm"
                        placeholder="Развернуть по полю (опц.)"
                        list="analytic-fields"
                      />
                      <button
                        type="button"
                        onClick={() => patchTpl((s) => {
                          const rules = { ...s.rules };
                          delete rules[row.id];
                          return { ...s, rows: s.rows.filter((r) => r.id !== row.id), rules };
                        })}
                        className="text-red-500 justify-self-end p-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Columns */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 font-bold text-sm text-slate-800 flex justify-between">
                  <span>Столбцы (период + фильтры)</span>
                  <button
                    type="button"
                    className="text-indigo-600 text-xs font-bold"
                    onClick={() => patchTpl((s) => {
                      const id = createColId();
                      const rules = { ...s.rules };
                      (s.rows || []).forEach((r) => {
                        rules[r.id] = { ...(rules[r.id] || {}), [id]: defaultCellRule() };
                      });
                      return {
                        ...s,
                        columns: [...(s.columns || []), { id, name: 'Новый период', startDate: '', endDate: '', filters: [] }],
                        rules,
                      };
                    })}
                  >
                    + Столбец
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {(editingTpl.structure.columns || []).map((col) => (
                    <div key={col.id} className="p-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <input
                          value={col.name}
                          onChange={(e) => patchTpl((s) => ({
                            ...s,
                            columns: s.columns.map((c) => (c.id === col.id ? { ...c, name: e.target.value } : c)),
                          }))}
                          className="border rounded p-2 text-sm font-bold"
                          placeholder="Имя столбца"
                        />
                        <input
                          type="date"
                          value={col.startDate || ''}
                          onChange={(e) => patchTpl((s) => ({
                            ...s,
                            columns: s.columns.map((c) => (c.id === col.id ? { ...c, startDate: e.target.value } : c)),
                          }))}
                          className="border rounded p-2 text-sm"
                        />
                        <input
                          type="date"
                          value={col.endDate || ''}
                          onChange={(e) => patchTpl((s) => ({
                            ...s,
                            columns: s.columns.map((c) => (c.id === col.id ? { ...c, endDate: e.target.value } : c)),
                          }))}
                          className="border rounded p-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => patchTpl((s) => {
                            const rules = { ...s.rules };
                            Object.keys(rules).forEach((rid) => {
                              if (rules[rid]) {
                                const copy = { ...rules[rid] };
                                delete copy[col.id];
                                rules[rid] = copy;
                              }
                            });
                            return { ...s, columns: s.columns.filter((c) => c.id !== col.id), rules };
                          })}
                          className="text-red-500 justify-self-end p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-500 font-medium">
                        Фильтры столбца (поле=значения через запятую), напр. Организация=ООО Альфа
                      </div>
                      <input
                        value={(col.filters || [])
                          .map((f) => `${f.columnName}=${(f.selectedValues || []).join('|')}`)
                          .join('; ')}
                        onChange={(e) => {
                          const filters = e.target.value
                            .split(';')
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .map((part) => {
                              const [columnName, vals] = part.split('=');
                              return {
                                columnName: (columnName || '').trim(),
                                selectedValues: (vals || '')
                                  .split('|')
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              };
                            })
                            .filter((f) => f.columnName);
                          patchTpl((s) => ({
                            ...s,
                            columns: s.columns.map((c) => (c.id === col.id ? { ...c, filters } : c)),
                          }));
                        }}
                        className="w-full border rounded p-2 text-sm font-mono"
                        placeholder="Организация=ООО Альфа|ООО Бета"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Cell rules matrix */}
              <div className="border border-slate-200 rounded-xl overflow-auto">
                <div className="bg-slate-50 px-4 py-2 font-bold text-sm text-slate-800 sticky left-0">
                  Правила ячеек (type / indicator / metric / expand)
                </div>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-white border-b">
                      <th className="p-2 text-left">Строка \\ Столбец</th>
                      {(editingTpl.structure.columns || []).map((c) => (
                        <th key={c.id} className="p-2 text-left font-bold">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(editingTpl.structure.rows || []).map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="p-2 font-bold whitespace-nowrap">{row.name}</td>
                        {(editingTpl.structure.columns || []).map((col) => {
                          const rule = editingRuleFor(row.id, col.id);
                          return (
                            <td key={col.id} className="p-2 min-w-[200px]">
                              <div className="space-y-1">
                                <select
                                  value={rule.type || 'db'}
                                  onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, type: e.target.value }))}
                                  className="w-full border rounded p-1 bg-white"
                                >
                                  <option value="db">db (проводки)</option>
                                  <option value="formula">formula</option>
                                  <option value="constant">constant</option>
                                </select>
                                {rule.type === 'db' && (
                                  <>
                                    <select
                                      value={rule.indicatorType || 'turnover'}
                                      onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, indicatorType: e.target.value }))}
                                      className="w-full border rounded p-1 bg-white"
                                    >
                                      {INDICATOR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                    <select
                                      value={rule.metricType || 'debit'}
                                      onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, metricType: e.target.value }))}
                                      className="w-full border rounded p-1 bg-white"
                                    >
                                      {METRIC_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                    </select>
                                    <select
                                      value={rule.expandAnalytic || 'no'}
                                      onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, expandAnalytic: e.target.value }))}
                                      className="w-full border rounded p-1 bg-white"
                                    >
                                      <option value="no">expand: no</option>
                                      <option value="debit">expand: debit</option>
                                      <option value="credit">expand: credit</option>
                                    </select>
                                  </>
                                )}
                                {rule.type === 'formula' && (
                                  <select
                                    value={rule.formulaId || ''}
                                    onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, formulaId: e.target.value }))}
                                    className="w-full border rounded p-1 bg-white"
                                  >
                                    <option value="">Формула…</option>
                                    {formulas.filter((f) => !f.isDeleted).map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </select>
                                )}
                                {rule.type === 'constant' && (
                                  <input
                                    type="number"
                                    value={rule.value ?? ''}
                                    onChange={(e) => patchTpl((s) => setCellRule(s, row.id, col.id, { ...rule, value: e.target.value }))}
                                    className="w-full border rounded p-1"
                                  />
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={saveTemplate} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2">
                  <Save className="w-4 h-4" /> Сохранить шаблон
                </button>
                <button type="button" onClick={() => setEditingTpl(null)} className="border px-5 py-2.5 rounded-xl font-bold text-sm">Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Pivot / Universal with drill-down ===== */}
      {tab === 'universal' && (
        <div className="space-y-4">
          <SourcePicker
            sources={sources}
            value={uniSourceId}
            onChange={setUniSourceId}
            label="Журнал проводок (из реестра)"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Шаблон отчёта</label>
              <select value={uniTplId || ''} onChange={(e) => setUniTplId(e.target.value || null)} className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white">
                <option value="">Выберите…</option>
                {templates.filter((t) => !t.isDeleted).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Глобальный период с</label>
              <input type="date" value={uniGlobalFrom} onChange={(e) => setUniGlobalFrom(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Глобальный период по</label>
              <input type="date" value={uniGlobalTo} onChange={(e) => setUniGlobalTo(e.target.value)} className="w-full border-slate-300 rounded-lg p-2 text-sm" />
            </div>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            Даты столбца перекрывают глобальные. Клик по числу открывает проводки; сумма в подвале = ячейка.
          </p>
          <button type="button" onClick={runPivot} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 inline-flex items-center gap-2">
            <Play className="w-4 h-4" /> Сформировать сводный отчёт
          </button>

          {uniResult && (
            <div className="space-y-3">
              {uniResult.errors?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                  {uniResult.errors.map((e, i) => (
                    <div key={i}>{e.row} / {e.col}: {e.message}</div>
                  ))}
                </div>
              )}
              <div className="overflow-auto border border-slate-200 rounded-xl max-h-[32rem]">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Показатель</th>
                      {uniResult.columns.map((c) => (
                        <th key={c.id} className="px-3 py-2 text-right font-bold text-slate-600 whitespace-nowrap">
                          {c.name}
                          {(c.startDate || c.endDate) && (
                            <div className="font-medium text-[10px] text-slate-400">
                              {c.startDate || '…'} — {c.endDate || '…'}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uniResult.rows.map((row) => (
                      <tr key={row.id} className="odd:bg-white even:bg-slate-50 border-t border-slate-100">
                        <td
                          className="px-3 py-1.5 font-bold text-slate-800"
                          style={{ paddingLeft: 12 + (row.level || 0) * 14 }}
                        >
                          {row.name}
                          {!row.isChild && row.accounts?.length > 0 && (
                            <span className="ml-2 text-[10px] font-mono text-slate-400">
                              [{row.accounts.join(', ')}]
                            </span>
                          )}
                        </td>
                        {uniResult.columns.map((col) => {
                          const ctx = uniResult.cells[`${row.id}|${col.id}`];
                          const val = row.values[col.id];
                          const clickable = ctx?.drillable;
                          const isFormula = ctx?.rule?.type === 'formula';
                          return (
                            <td
                              key={col.id}
                              className={`px-3 py-1.5 text-right font-mono ${
                                clickable
                                  ? 'cursor-pointer text-indigo-700 font-bold hover:bg-indigo-50 underline decoration-dotted'
                                  : isFormula
                                    ? 'cursor-not-allowed text-slate-500'
                                    : ''
                              }`}
                              title={
                                clickable
                                  ? 'Показать проводки'
                                  : isFormula
                                    ? 'Формула — drill-down недоступен'
                                    : undefined
                              }
                              onClick={() => openDrill(row, col)}
                            >
                              {fmt(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const flat = uniResult.rows.map((r) => {
                      const o = { Показатель: r.name };
                      uniResult.columns.forEach((c) => { o[c.name] = r.values[c.id]; });
                      return o;
                    });
                    exportToExcel(flat, 'Pivot_Report.xlsx');
                  }}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
                >
                  Excel
                </button>
                <button type="button" onClick={() => window.print()} className="bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm">
                  Печать / PDF
                </button>
                {onRegisterResult && (
                  <button
                    type="button"
                    onClick={() => {
                      const flat = uniResult.rows.map((r) => {
                        const o = { Показатель: r.name };
                        uniResult.columns.forEach((c) => { o[c.name] = r.values[c.id]; });
                        return o;
                      });
                      onRegisterResult(flat, 'Сводный_отчёт');
                    }}
                    className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >
                    В реестр
                  </button>
                )}
              </div>
            </div>
          )}

          {uniSource && filterFieldOptions.length > 0 && (
            <datalist id="analytic-fields">
              {filterFieldOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
        </div>
      )}

      <DrillDownModal payload={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
