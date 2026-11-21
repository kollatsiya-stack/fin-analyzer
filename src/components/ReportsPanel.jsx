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
import {
  buildAccountAnalysis,
  buildAccountCard,
  buildOsv,
  buildSubcontoAnalysis,
  detectPostingColumns,
  listAnalyticsColumns,
} from '../lib/reports1c.js';
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
  emptyReportStructure,
  excelFormulaToRowTotal,
  importStructureFromRows,
  loadTemplatesFromStorage,
  makeReportTemplate,
  runUniversalReport,
  saveTemplatesToStorage,
  upsertTemplate,
} from '../lib/reportBuilder.js';
import { exportToExcel, readFileAsWorkbook } from '../lib/excel.js';
import { columnsFromData } from '../lib/parse.js';

const TABS = [
  { id: 'std', label: 'Стандартные отчёты 1С', icon: FileSpreadsheet },
  { id: 'formulas', label: 'Шаблоны формул', icon: Calculator },
  { id: 'templates', label: 'Шаблоны отчётов', icon: Layers },
  { id: 'universal', label: 'Универсальный отчёт', icon: Play },
];

export default function ReportsPanel({ sources = [], onRegisterResult }) {
  const [tab, setTab] = useState('std');
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

  // --- Templates ---
  const [templates, setTemplates] = useState(() => loadTemplatesFromStorage());
  const [editingTpl, setEditingTpl] = useState(null);

  // --- Universal ---
  const [uniTplId, setUniTplId] = useState(null);
  const [uniPeriod, setUniPeriod] = useState('');
  const [uniResult, setUniResult] = useState(null);
  const [uniDrill, setUniDrill] = useState(null);

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
          expression: {
            type: 'compound',
            items: [{ type: 'argument', ref: '' }],
          },
        },
      })
    );
    setFormulaTest(null);
  };

  const saveFormula = () => {
    if (!editingFormula?.name) return;
    // Fix expression arg refs if single arg
    const cfg = editingFormula.config;
    if (cfg.arguments?.length === 1 && cfg.expression?.items?.length) {
      cfg.expression.items = cfg.expression.items.map((it) =>
        it.type === 'argument' && !it.ref ? { ...it, ref: cfg.arguments[0].id } : it
      );
    }
    const next = upsertFormula(formulas, { ...editingFormula, config: cfg });
    persistFormulas(next);
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
    const next = upsertTemplate(templates, editingTpl);
    persistTemplates(next);
    setSuccess(`Шаблон «${editingTpl.name}» сохранён`);
    setEditingTpl(null);
  };

  const importTplStructure = async (file) => {
    if (!file || !editingTpl) return;
    try {
      const parsed = await readFileAsWorkbook(file);
      const structure = importStructureFromRows(parsed.data);
      setEditingTpl({ ...editingTpl, structure: { ...editingTpl.structure, rows: structure.rows } });
      setSuccess(`Импортировано строк: ${structure.rows.length}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const runUniversal = () => {
    setError('');
    setUniDrill(null);
    try {
      const tpl = templates.find((t) => t.id === uniTplId);
      if (!tpl) throw new Error('Выберите шаблон отчёта');
      const result = runUniversalReport({
        template: tpl,
        sources,
        formulas,
        periodLabel: uniPeriod || 'Период',
      });
      setUniResult(result);
      setSuccess(
        `Отчёт сформирован: ${result.rows.length} строк` +
          (result.errors.length ? `, ошибок: ${result.errors.length}` : '')
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const updateArg = (argId, patch) => {
    setEditingFormula((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        arguments: prev.config.arguments.map((a) => (a.id === argId ? { ...a, ...patch } : a)),
      },
    }));
  };

  const setCellRule = (rowNumber, colCode, rule) => {
    setEditingTpl((prev) => {
      const key = `row:${rowNumber},col:${colCode}`;
      const cellRules = { ...prev.structure.cellRules };
      if (!rule || rule.type === 'empty') delete cellRules[key];
      else cellRules[key] = rule;
      return { ...prev, structure: { ...prev.structure, cellRules } };
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800">Шаг 4. Отчёты</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Стандартные отчёты 1С и конструктор: формулы → шаблоны → универсальный отчёт. Источники — только из реестра.
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
          <SourcePicker
            sources={sources}
            value={stdSourceId}
            onChange={setStdSourceId}
            label="Таблица проводок (из реестра)"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Тип отчёта</label>
              <select
                value={stdKind}
                onChange={(e) => setStdKind(e.target.value)}
                className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
              >
                <option value="osv">ОСВ по всем счетам</option>
                <option value="osv_filter">ОСВ по выбранным счетам</option>
                <option value="card">Карточка счёта</option>
                <option value="analysis">Анализ счёта</option>
                <option value="subconto">Анализ субконто</option>
              </select>
            </div>
            {(stdKind !== 'osv' || stdKind === 'osv_filter') && stdKind !== 'subconto' && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Счёт (префикс)</label>
                <input
                  value={stdAccount}
                  onChange={(e) => setStdAccount(e.target.value)}
                  placeholder="41 или 41.01"
                  className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold"
                />
              </div>
            )}
            {(stdKind === 'analysis' || stdKind === 'subconto') && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Колонка аналитики</label>
                <select
                  value={stdAnalyticsCol}
                  onChange={(e) => setStdAnalyticsCol(e.target.value)}
                  className="w-full border-slate-300 rounded-lg p-2 text-sm bg-white font-bold"
                >
                  <option value="">—</option>
                  {analyticsCols.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            {stdKind === 'subconto' && (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">Сторона</label>
                <select
                  value={stdSide}
                  onChange={(e) => setStdSide(e.target.value)}
                  className="w-full border-slate-300 rounded-lg p-2 text-sm bg-white font-bold"
                >
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
              <DataPreview
                data={
                  stdResult.totals
                    ? [...stdResult.data, stdResult.totals]
                    : stdResult.data
                }
                columns={stdResult.columns}
                maxRows={100}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => exportToExcel(stdResult.totals ? [...stdResult.data, stdResult.totals] : stdResult.data, 'OSV.xlsx')}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
                >
                  Excel
                </button>
                {onRegisterResult && (
                  <button
                    type="button"
                    onClick={() =>
                      onRegisterResult(
                        stdResult.totals ? [...stdResult.data, stdResult.totals] : stdResult.data,
                        `Отчёт_${stdKind}`
                      )
                    }
                    className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >
                    В реестр
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Formulas ===== */}
      {tab === 'formulas' && (
        <div className="space-y-4">
          {!editingFormula ? (
            <>
              <button type="button" onClick={startNewFormula} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Новая формула
              </button>
              <div className="border border-slate-200 rounded-xl divide-y">
                {formulas.filter((f) => !f.isDeleted).length === 0 && (
                  <p className="p-4 text-sm text-slate-500 font-medium">Справочник пуст</p>
                )}
                {formulas.filter((f) => !f.isDeleted).map((f) => (
                  <div key={f.id} className="p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm text-slate-800">{f.name}</div>
                      <div className="text-xs text-slate-500">{f.group} · v{f.version} · аргументов: {f.config?.arguments?.length || 0}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setEditingFormula(JSON.parse(JSON.stringify(f))); setFormulaTest(null); }} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100">Изменить</button>
                      <button type="button" onClick={() => persistFormulas(formulas.map((x) => x.id === f.id ? { ...x, isDeleted: true } : x))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Наименование</label>
                  <input value={editingFormula.name} onChange={(e) => setEditingFormula({ ...editingFormula, name: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm font-bold" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Группа</label>
                  <input value={editingFormula.group} onChange={(e) => setEditingFormula({ ...editingFormula, group: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm" />
                </div>
              </div>

              <h4 className="font-bold text-slate-800 text-sm">Аргументы</h4>
              {(editingFormula.config.arguments || []).map((arg) => {
                const src = sources.find((s) => s.id === arg.sourceId);
                return (
                  <div key={arg.id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                    <input value={arg.name} onChange={(e) => updateArg(arg.id, { name: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm font-bold" placeholder="Имя аргумента" />
                    <SourcePicker sources={sources} value={arg.sourceId} onChange={(id) => updateArg(arg.id, { sourceId: id })} label="Таблица из реестра" />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Ресурс</label>
                        <select value={arg.resourceCol} onChange={(e) => updateArg(arg.id, { resourceCol: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                          <option value="">—</option>
                          {(src?.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Агрегат</label>
                        <select value={arg.aggregation} onChange={(e) => updateArg(arg.id, { aggregation: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                          {['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'].map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">Развёртка по</label>
                        <select value={arg.expandBy || ''} onChange={(e) => updateArg(arg.id, { expandBy: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                          <option value="">—</option>
                          {(src?.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={!!arg.useNegative} onChange={(e) => updateArg(arg.id, { useNegative: e.target.checked })} />
                      Использовать отрицательное
                    </label>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500">Фильтры И/ИЛИ</span>
                        <button type="button" className="text-xs font-bold text-indigo-600" onClick={() => updateArg(arg.id, { filters: [...(arg.filters || []), { logic: 'AND', field: '', op: 'равно', value: '' }] })}>+ Условие</button>
                      </div>
                      {(arg.filters || []).map((f, fi) => (
                        <div key={fi} className="flex flex-wrap gap-2 items-center">
                          {fi > 0 && (
                            <select value={f.logic} onChange={(e) => {
                              const filters = arg.filters.slice();
                              filters[fi] = { ...f, logic: e.target.value };
                              updateArg(arg.id, { filters });
                            }} className="border-slate-300 rounded p-1.5 text-xs w-16">
                              <option value="AND">И</option>
                              <option value="OR">ИЛИ</option>
                            </select>
                          )}
                          <select value={f.field} onChange={(e) => {
                            const filters = arg.filters.slice();
                            filters[fi] = { ...f, field: e.target.value };
                            updateArg(arg.id, { filters });
                          }} className="border-slate-300 rounded p-1.5 text-xs flex-1">
                            <option value="">Поле...</option>
                            {(src?.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <select value={f.op} onChange={(e) => {
                            const filters = arg.filters.slice();
                            filters[fi] = { ...f, op: e.target.value };
                            updateArg(arg.id, { filters });
                          }} className="border-slate-300 rounded p-1.5 text-xs w-28">
                            {['равно', 'не равно', 'содержит', 'не содержит', 'больше', 'меньше', 'пусто', 'не пусто'].map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                          <input value={f.value} onChange={(e) => {
                            const filters = arg.filters.slice();
                            filters[fi] = { ...f, value: e.target.value };
                            updateArg(arg.id, { filters });
                          }} className="border-slate-300 rounded p-1.5 text-xs flex-1" placeholder="Значение" />
                        </div>
                      ))}
                    </div>
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-2 space-y-2">
                      <span className="text-xs font-bold text-indigo-800">ВПР-связь с другой таблицей</span>
                      <SourcePicker
                        sources={sources}
                        value={arg.vlookup?.sourceId || null}
                        onChange={(id) => updateArg(arg.id, { vlookup: { ...(arg.vlookup || {}), sourceId: id } })}
                        label="Справочник"
                        excludeIds={arg.sourceId ? [arg.sourceId] : []}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {['leftField', 'rightField', 'pullField'].map((field, i) => {
                          const labels = ['Поле связи (осн.)', 'Поле соответствия', 'Забираемое поле'];
                          const cols = field === 'leftField' ? src?.columns : sources.find((s) => s.id === arg.vlookup?.sourceId)?.columns;
                          return (
                            <div key={field}>
                              <label className="text-xs font-bold text-slate-500 mb-1 block">{labels[i]}</label>
                              <select
                                value={arg.vlookup?.[field] || ''}
                                onChange={(e) => updateArg(arg.id, { vlookup: { ...(arg.vlookup || {}), [field]: e.target.value } })}
                                className="w-full border-slate-300 rounded p-1.5 text-xs bg-white"
                              >
                                <option value="">—</option>
                                {(cols || []).map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setEditingFormula({
                    ...editingFormula,
                    config: {
                      ...editingFormula.config,
                      arguments: [...editingFormula.config.arguments, makeArgument({ name: `Аргумент ${editingFormula.config.arguments.length + 1}` })],
                    },
                  })
                }
                className="text-sm font-bold text-indigo-600"
              >
                + Аргумент
              </button>

              <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                <h4 className="font-bold text-slate-800 text-sm">Калькулятор выражения</h4>
                <div className="flex flex-wrap gap-2">
                  {(editingFormula.config.arguments || []).map((a) => (
                    <button key={a.id} type="button" onClick={() => setEditingFormula({
                      ...editingFormula,
                      config: {
                        ...editingFormula.config,
                        expression: {
                          type: 'compound',
                          items: [...(editingFormula.config.expression?.items || []), { type: 'argument', ref: a.id }],
                        },
                      },
                    })} className="text-xs font-bold px-2 py-1 rounded bg-indigo-50 text-indigo-700">{a.name}</button>
                  ))}
                  {['+', '-', '*', '/', '(', ')'].map((op) => (
                    <button key={op} type="button" onClick={() => setEditingFormula({
                      ...editingFormula,
                      config: {
                        ...editingFormula.config,
                        expression: {
                          type: 'compound',
                          items: [...(editingFormula.config.expression?.items || []), { type: 'operator', value: op }],
                        },
                      },
                    })} className="text-xs font-bold px-2 py-1 rounded bg-slate-100 w-8">{op}</button>
                  ))}
                  <button type="button" onClick={() => {
                    const v = window.prompt('Константа', '1');
                    if (v == null) return;
                    setEditingFormula({
                      ...editingFormula,
                      config: {
                        ...editingFormula.config,
                        expression: {
                          type: 'compound',
                          items: [...(editingFormula.config.expression?.items || []), { type: 'constant', value: Number(v) }],
                        },
                      },
                    });
                  }} className="text-xs font-bold px-2 py-1 rounded bg-amber-50 text-amber-800">Константа</button>
                  <button type="button" onClick={() => setEditingFormula({
                    ...editingFormula,
                    config: { ...editingFormula.config, expression: { type: 'compound', items: [] } },
                  })} className="text-xs font-bold px-2 py-1 rounded bg-red-50 text-red-700">Очистить</button>
                </div>
                <div className="font-mono text-xs bg-slate-900 text-green-400 p-3 rounded-lg overflow-x-auto">
                  {(editingFormula.config.expression?.items || []).map((it, i) => {
                    if (it.type === 'argument') {
                      const a = editingFormula.config.arguments.find((x) => x.id === it.ref);
                      return <span key={i}>[{a?.name || it.ref}] </span>;
                    }
                    if (it.type === 'constant') return <span key={i}>{it.value} </span>;
                    if (it.type === 'formula') {
                      const f = formulas.find((x) => x.id === it.ref);
                      return <span key={i}>{`{${f?.name || it.ref}}`} </span>;
                    }
                    return <span key={i}>{it.value} </span>;
                  }) || '—'}
                </div>
              </div>

              {formulaTest && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm font-bold text-green-800">
                  Результат теста: {formulaTest.value}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={testFormula} className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm">Рассчитать (тест)</button>
                <button type="button" onClick={saveFormula} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-1"><Save className="w-4 h-4" /> Сохранить</button>
                <button type="button" onClick={() => setEditingFormula(null)} className="bg-white border border-slate-200 px-4 py-2 rounded-lg font-bold text-sm">Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Templates ===== */}
      {tab === 'templates' && (
        <div className="space-y-4">
          {!editingTpl ? (
            <>
              <button type="button" onClick={startNewTemplate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm inline-flex items-center gap-2">
                <Plus className="w-4 h-4" /> Новый шаблон отчёта
              </button>
              <div className="border border-slate-200 rounded-xl divide-y">
                {templates.filter((t) => !t.isDeleted).length === 0 && (
                  <p className="p-4 text-sm text-slate-500 font-medium">Справочник пуст</p>
                )}
                {templates.filter((t) => !t.isDeleted).map((t) => (
                  <div key={t.id} className="p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-sm">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.group} · строк: {t.structure?.rows?.length || 0} · столбцов: {t.structure?.columns?.length || 0}</div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setEditingTpl(JSON.parse(JSON.stringify(t)))} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100">Изменить</button>
                      <button type="button" onClick={() => persistTemplates(templates.map((x) => x.id === t.id ? { ...x, isDeleted: true } : x))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={editingTpl.name} onChange={(e) => setEditingTpl({ ...editingTpl, name: e.target.value })} className="border-slate-300 rounded p-2 text-sm font-bold" placeholder="Название отчёта" />
                <input value={editingTpl.group} onChange={(e) => setEditingTpl({ ...editingTpl, group: e.target.value })} className="border-slate-300 rounded p-2 text-sm" placeholder="Группа" />
              </div>
              <label className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-2 rounded-lg cursor-pointer font-bold text-xs inline-flex items-center gap-2 w-fit">
                Импорт структуры из Excel
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { importTplStructure(e.target.files?.[0]); e.target.value = ''; }} />
              </label>

              <div className="overflow-auto border border-slate-200 rounded-xl bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left">№</th>
                      <th className="p-2 text-left">Код</th>
                      <th className="p-2 text-left">Наименование</th>
                      <th className="p-2 text-left">Тип</th>
                      {editingTpl.structure.columns.map((c) => (
                        <th key={c.code} className="p-2 text-left">{c.name}</th>
                      ))}
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {editingTpl.structure.rows.map((row) => (
                      <tr key={row.number} className="border-t border-slate-100">
                        <td className="p-2 font-mono">{row.number}</td>
                        <td className="p-2">
                          <input value={row.code} onChange={(e) => {
                            const rows = editingTpl.structure.rows.map((r) => r.number === row.number ? { ...r, code: e.target.value } : r);
                            setEditingTpl({ ...editingTpl, structure: { ...editingTpl.structure, rows } });
                          }} className="border rounded px-1 py-0.5 w-20" />
                        </td>
                        <td className="p-2">
                          <input value={row.name} onChange={(e) => {
                            const rows = editingTpl.structure.rows.map((r) => r.number === row.number ? { ...r, name: e.target.value } : r);
                            setEditingTpl({ ...editingTpl, structure: { ...editingTpl.structure, rows } });
                          }} className="border rounded px-1 py-0.5 w-40" style={{ paddingLeft: 8 + (row.level || 0) * 12 }} />
                        </td>
                        <td className="p-2">
                          <select value={row.type} onChange={(e) => {
                            const rows = editingTpl.structure.rows.map((r) => r.number === row.number ? { ...r, type: e.target.value } : r);
                            setEditingTpl({ ...editingTpl, structure: { ...editingTpl.structure, rows } });
                          }} className="border rounded px-1 py-0.5">
                            <option value="calculation">Обычная</option>
                            <option value="consolidating">Консолидирующая</option>
                            <option value="total">Итоговая</option>
                            <option value="hidden">Скрытая</option>
                          </select>
                        </td>
                        {editingTpl.structure.columns.map((col) => {
                          const key = `row:${row.number},col:${col.code}`;
                          const rule = editingTpl.structure.cellRules?.[key] || { type: 'empty' };
                          return (
                            <td key={col.code} className="p-2 align-top">
                              <select
                                value={rule.type}
                                onChange={(e) => {
                                  const type = e.target.value;
                                  if (type === 'empty') setCellRule(row.number, col.code, null);
                                  else if (type === 'formula') setCellRule(row.number, col.code, { type, formulaId: formulas[0]?.id || '' });
                                  else if (type === 'rowTotal') setCellRule(row.number, col.code, { type, expression: '' });
                                  else if (type === 'colTotal') setCellRule(row.number, col.code, { type, aggregation: 'SUM' });
                                  else if (type === 'constant') setCellRule(row.number, col.code, { type, value: 0 });
                                }}
                                className="border rounded px-1 py-0.5 w-full mb-1"
                              >
                                <option value="empty">Пусто</option>
                                <option value="formula">Формула</option>
                                <option value="rowTotal">Итоги по строкам</option>
                                <option value="colTotal">Итоги по столбцам</option>
                                <option value="constant">Константа</option>
                              </select>
                              {rule.type === 'formula' && (
                                <select value={rule.formulaId || ''} onChange={(e) => setCellRule(row.number, col.code, { ...rule, formulaId: e.target.value })} className="border rounded px-1 py-0.5 w-full">
                                  <option value="">—</option>
                                  {formulas.filter((f) => !f.isDeleted).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                              )}
                              {rule.type === 'rowTotal' && (
                                <input
                                  value={rule.expression || ''}
                                  onChange={(e) => setCellRule(row.number, col.code, { ...rule, expression: e.target.value })}
                                  onBlur={(e) => {
                                    if (e.target.value.trim().startsWith('=')) {
                                      setCellRule(row.number, col.code, { ...rule, expression: excelFormulaToRowTotal(e.target.value) });
                                    }
                                  }}
                                  placeholder="[1]+[2] или =B1+B2"
                                  className="border rounded px-1 py-0.5 w-full font-mono"
                                />
                              )}
                              {rule.type === 'constant' && (
                                <input type="number" value={rule.value ?? 0} onChange={(e) => setCellRule(row.number, col.code, { ...rule, value: Number(e.target.value) })} className="border rounded px-1 py-0.5 w-full" />
                              )}
                            </td>
                          );
                        })}
                        <td className="p-2">
                          <button type="button" onClick={() => {
                            const rows = editingTpl.structure.rows.filter((r) => r.number !== row.number);
                            setEditingTpl({ ...editingTpl, structure: { ...editingTpl.structure, rows } });
                          }} className="text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => {
                  const rows = editingTpl.structure.rows;
                  const number = (rows[rows.length - 1]?.number || 0) + 1;
                  setEditingTpl({
                    ...editingTpl,
                    structure: {
                      ...editingTpl.structure,
                      rows: [...rows, { number, code: String(number).padStart(2, '0'), name: `Строка ${number}`, level: 0, type: 'calculation', zone: '', sign: '+', hidden: false }],
                    },
                  });
                }} className="text-sm font-bold text-indigo-600">+ Строка</button>
                <button type="button" onClick={() => {
                  const code = `C${editingTpl.structure.columns.length + 1}`;
                  setEditingTpl({
                    ...editingTpl,
                    structure: {
                      ...editingTpl.structure,
                      columns: [...editingTpl.structure.columns, { code, name: `Столбец ${code}`, type: 'static', format: 'number' }],
                    },
                  });
                }} className="text-sm font-bold text-indigo-600">+ Столбец</button>
                <button type="button" onClick={saveTemplate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm ml-auto">Сохранить шаблон</button>
                <button type="button" onClick={() => setEditingTpl(null)} className="bg-white border px-4 py-2 rounded-lg font-bold text-sm">Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== Universal ===== */}
      {tab === 'universal' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Шаблон отчёта</label>
              <select value={uniTplId || ''} onChange={(e) => setUniTplId(e.target.value || null)} className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white">
                <option value="">Выберите...</option>
                {templates.filter((t) => !t.isDeleted).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Период (подпись)</label>
              <input value={uniPeriod} onChange={(e) => setUniPeriod(e.target.value)} placeholder="Май 2024" className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold" />
            </div>
          </div>
          <button type="button" onClick={runUniversal} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 inline-flex items-center gap-2">
            <Play className="w-4 h-4" /> Сформировать универсальный отчёт
          </button>
          {uniResult && (
            <div className="space-y-3">
              {uniResult.errors?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                  {uniResult.errors.map((e, i) => (
                    <div key={i}>Строка {e.row}, столбец {e.col}: {e.message}</div>
                  ))}
                </div>
              )}
              <div className="overflow-auto border border-slate-200 rounded-xl max-h-96">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      {uniResult.columnHeaders.map((h) => (
                        <th key={h.key} className="px-3 py-2 text-left font-bold text-slate-600">{h.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {uniResult.rows.map((row, ri) => (
                      <tr key={ri} className="odd:bg-white even:bg-slate-50 border-t border-slate-100">
                        {uniResult.columnHeaders.map((h) => {
                          const val = row[h.key];
                          const isNum = typeof val === 'number';
                          const drillKey = h.key.includes('::')
                            ? `${templates.find((t) => t.id === uniTplId)?.structure?.rows?.find((r) => r.code === row.code)?.number}:${h.key.split('::')[0]}`
                            : null;
                          return (
                            <td
                              key={h.key}
                              className={`px-3 py-1.5 ${isNum ? 'text-right font-mono cursor-pointer hover:bg-indigo-50' : ''}`}
                              style={{ paddingLeft: h.key === 'name' ? 8 + (row.level || 0) * 12 : undefined }}
                              onClick={() => {
                                if (!isNum || !drillKey) return;
                                setUniDrill(uniResult.drilldown?.[drillKey] || null);
                              }}
                            >
                              {val == null || val === '' ? '—' : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {uniDrill && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm">
                  <h4 className="font-bold text-indigo-900 mb-2">Расшифровка (drill-down)</h4>
                  <pre className="text-xs overflow-auto max-h-40 bg-white p-2 rounded border">{JSON.stringify(uniDrill, null, 2)}</pre>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const flat = uniResult.rows.map((r) => {
                      const o = {};
                      uniResult.columnHeaders.forEach((h) => { o[h.label] = r[h.key]; });
                      return o;
                    });
                    exportToExcel(flat, 'Universal_Report.xlsx');
                  }}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
                >
                  Excel
                </button>
                <button type="button" onClick={() => window.print()} className="bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm">Печать / PDF</button>
                {onRegisterResult && (
                  <button
                    type="button"
                    onClick={() => {
                      const flat = uniResult.rows.map((r) => {
                        const o = {};
                        uniResult.columnHeaders.forEach((h) => { o[h.label] = r[h.key]; });
                        return o;
                      });
                      onRegisterResult(flat, 'Универсальный_отчёт');
                    }}
                    className="bg-slate-800 text-white px-4 py-2 rounded-lg font-bold text-sm"
                  >
                    В реестр
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
