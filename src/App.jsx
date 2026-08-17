import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calculator,
  CalendarClock,
  Check,
  Filter,
  RefreshCcw,
  Save,
  Scissors,
  Search,
  Sliders,
  Trash2,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import FileSource, { LoadedBadge } from './components/FileSource.jsx';
import DataPreview from './components/DataPreview.jsx';
import { columnsFromData, uniqueSorted } from './lib/parse.js';
import {
  exportToExcel,
  loadFromLink,
  pairsFromRows,
  parseMappingFile,
  readFileAsWorkbook,
} from './lib/excel.js';
import { rulesFromRows, runRule } from './lib/etl.js';

const createEmptySource = () => ({
  file: null,
  data: [],
  columns: [],
  error: '',
  loading: false,
  link: '',
  sheets: [],
  activeSheet: '',
  allData: {},
  isLoaded: false,
});

const RULES = [
  { id: 1, name: 'Обогащение/объединение данных', desc: 'Добавление аналитик, объединение баз, тегирование', icon: Search, color: 'text-blue-600', bg: 'bg-blue-100', border: 'hover:border-blue-300' },
  { id: 2, name: 'Сплитование', desc: 'Аллокация сумм по драйверам и базам', icon: Scissors, color: 'text-orange-600', bg: 'bg-orange-100', border: 'hover:border-orange-300' },
  { id: 3, name: 'Мэппинг', desc: 'Переклассификация и замена значений', icon: RefreshCcw, color: 'text-emerald-600', bg: 'bg-emerald-100', border: 'hover:border-emerald-300' },
  { id: 4, name: 'Элиминация', desc: 'Фильтрация, черные списки, ВГО', icon: Filter, color: 'text-red-600', bg: 'bg-red-100', border: 'hover:border-red-300' },
  { id: 5, name: 'Агрегация', desc: 'Свертка данных с сохранением детализации', icon: Sliders, color: 'text-purple-600', bg: 'bg-purple-100', border: 'hover:border-purple-300' },
  { id: 6, name: 'Временные сдвиги', desc: 'Начисления, РБП, перенос дат', icon: CalendarClock, color: 'text-teal-600', bg: 'bg-teal-100', border: 'hover:border-teal-300' },
  { id: 7, name: 'Вменение (Проводки)', desc: 'План счетов и матрица операций Дт/Кт', icon: Calculator, color: 'text-pink-600', bg: 'bg-pink-100', border: 'hover:border-pink-300' },
  { id: 8, name: 'Переоценка', desc: 'Управленческие коэффициенты и курсы', icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-100', border: 'hover:border-amber-300' },
];

export default function App() {
  const [step, setStep] = useState(1);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [source1, setSource1] = useState(createEmptySource);
  const [source1Snapshot, setSource1Snapshot] = useState(null);
  const [source2, setSource2] = useState(createEmptySource);
  const [coaSource, setCoaSource] = useState(createEmptySource);
  const [opsSource, setOpsSource] = useState(createEmptySource);

  const [activeRule, setActiveRule] = useState(null);
  const [resultData, setResultData] = useState([]);
  const [chainEnabled, setChainEnabled] = useState(true);

  const [enrichMode, setEnrichMode] = useState('rules');
  const [enrichTargetCol, setEnrichTargetCol] = useState('');
  const [enrichKeys, setEnrichKeys] = useState([
    { id: 1, k1: '', k2: '', logic: 'AND', exact: true, synonyms: [] },
  ]);
  const [enrichPullCols, setEnrichPullCols] = useState([{ id: 1, col: '' }]);
  const [enrichRuleInput, setEnrichRuleInput] = useState({ col: '', op: 'содержит', val: '', tag: '' });
  const [enrichRules, setEnrichRules] = useState([]);
  const [enrichRulesSource, setEnrichRulesSource] = useState(createEmptySource);

  const [synModalKeyId, setSynModalKeyId] = useState(null);
  const [synInputA, setSynInputA] = useState('');
  const [synInputB, setSynInputB] = useState('');
  const [synSearchA, setSynSearchA] = useState('');
  const [synSearchB, setSynSearchB] = useState('');

  const [allocKeys, setAllocKeys] = useState([{ id: 1, k1: '', k2: '' }]);
  const [allocSumCol, setAllocSumCol] = useState('');
  const [allocDriverCol, setAllocDriverCol] = useState('');

  const [mapSourceCol, setMapSourceCol] = useState('');
  const [mapRules, setMapRules] = useState([{ id: 1, src: '', target: '' }]);

  const [elimRules, setElimRules] = useState([{ id: 1, logic: 'AND', col: '', op: 'равно', val: '' }]);
  const [elimAction, setElimAction] = useState('soft');

  const [aggGroupCols, setAggGroupCols] = useState([]);
  const [aggItemCol, setAggItemCol] = useState('');
  const [aggSumCol, setAggSumCol] = useState('');
  const [aggGroups, setAggGroups] = useState([]);
  const [currentGroupName, setCurrentGroupName] = useState('');
  const [currentGroupItems, setCurrentGroupItems] = useState([]);
  const [currentItemSelect, setCurrentItemSelect] = useState('');

  const [accrualRules, setAccrualRules] = useState([{ id: 1, logic: 'AND', col: '', op: 'содержит', val: '' }]);
  const [accrualAction, setAccrualAction] = useState('split');
  const [accrualMonths, setAccrualMonths] = useState('12');
  const [accrualDateCol, setAccrualDateCol] = useState('');
  const [accrualDateVal, setAccrualDateVal] = useState('');
  const [accrualSumCol, setAccrualSumCol] = useState('');

  const [coaAccCol, setCoaAccCol] = useState('');
  const [opsCol, setOpsCol] = useState('');
  const [virtRules, setVirtRules] = useState([]);

  const [revalSumCol, setRevalSumCol] = useState('');
  const [revalRate, setRevalRate] = useState('1.2');

  const resultColumns = useMemo(() => columnsFromData(resultData), [resultData]);
  const mapValues = useMemo(
    () => (mapSourceCol ? uniqueSorted(source1.data.map((r) => r[mapSourceCol])) : []),
    [mapSourceCol, source1.data]
  );
  const aggItems = useMemo(
    () => (aggItemCol ? uniqueSorted(source1.data.map((r) => r[aggItemCol])) : []),
    [aggItemCol, source1.data]
  );
  const coaAccounts = useMemo(
    () => (coaAccCol ? uniqueSorted(coaSource.data.map((r) => r[coaAccCol])) : []),
    [coaAccCol, coaSource.data]
  );

  const updateEnrichKey = (id, patch) =>
    setEnrichKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  const synKey = enrichKeys.find((k) => k.id === synModalKeyId) || null;
  const synValuesA = useMemo(
    () => (synKey?.k1 ? uniqueSorted(source1.data.map((r) => r[synKey.k1])) : []),
    [synKey?.k1, source1.data]
  );
  const synValuesB = useMemo(
    () => (synKey?.k2 ? uniqueSorted(source2.data.map((r) => r[synKey.k2])) : []),
    [synKey?.k2, source2.data]
  );

  const openSynModal = (id) => {
    setSynInputA('');
    setSynInputB('');
    setSynSearchA('');
    setSynSearchB('');
    setSynModalKeyId(id);
  };

  const addSynonym = () => {
    if (!synKey || !synInputA || !synInputB) return;
    const exists = (synKey.synonyms || []).some((p) => p.a === synInputA && p.b === synInputB);
    if (!exists) {
      updateEnrichKey(synKey.id, { synonyms: [...(synKey.synonyms || []), { a: synInputA, b: synInputB }] });
    }
    setSynInputA('');
    setSynInputB('');
  };

  const removeSynonym = (idx) => {
    if (!synKey) return;
    updateEnrichKey(synKey.id, { synonyms: (synKey.synonyms || []).filter((_, i) => i !== idx) });
  };

  const loadSynonymFile = async (file) => {
    if (!file || !synKey) return;
    try {
      const parsed = await readFileAsWorkbook(file);
      const pairs = pairsFromRows(parsed.data);
      if (!pairs.length) {
        setErrorMsg('В файле соответствий не найдено пар (нужны минимум две колонки: значение 1 → значение 2)');
        return;
      }
      const existing = new Set((synKey.synonyms || []).map((p) => `${p.a}|||${p.b}`));
      const merged = [...(synKey.synonyms || [])];
      for (const p of pairs) {
        const sig = `${p.a}|||${p.b}`;
        if (!existing.has(sig)) {
          existing.add(sig);
          merged.push(p);
        }
      }
      updateEnrichKey(synKey.id, { synonyms: merged });
      setErrorMsg('');
    } catch (err) {
      setErrorMsg('Ошибка загрузки файла соответствий: ' + err.message);
    }
  };

  const importEnrichRules = () => {
    const imported = rulesFromRows(enrichRulesSource.data);
    if (!imported.length) {
      setErrorMsg(
        'В файле не найдено корректных правил. Нужны колонки: «Колонка», «Условие», «Значение», «Тег».'
      );
      return;
    }
    setEnrichRules((prev) => [...prev, ...imported]);
    setSuccessMsg(`Импортировано правил из файла: ${imported.length}`);
    setErrorMsg('');
  };

  useEffect(() => {
    if (!opsCol || !opsSource.isLoaded || !opsSource.data.length) return;
    const uniqueOps = uniqueSorted(opsSource.data.map((r) => r[opsCol]));
    setVirtRules((prev) => {
      const prevMap = Object.fromEntries(prev.map((r) => [r.opName, r]));
      return uniqueOps.map((op, i) =>
        prevMap[op] ? { ...prevMap[op], id: i } : { id: i, opName: op, dt: '', ct: '' }
      );
    });
  }, [opsCol, opsSource.data, opsSource.isLoaded]);

  const applyParsed = (parsed, setSource, snapshot = false) => {
    setSource((prev) => ({
      ...prev,
      ...parsed,
      loading: false,
      isLoaded: true,
      error: '',
      link: '',
    }));
    if (snapshot) {
      setSource1Snapshot({
        data: parsed.data,
        columns: parsed.columns,
        sheets: parsed.sheets,
        activeSheet: parsed.activeSheet,
        allData: parsed.allData,
      });
    }
  };

  const processFile = async (file, setSource, snapshot = false) => {
    if (!file) return;
    setErrorMsg('');
    setSource((prev) => ({ ...prev, loading: true, error: '', file }));
    try {
      const parsed = await readFileAsWorkbook(file);
      applyParsed(parsed, setSource, snapshot);
    } catch (err) {
      setSource((prev) => ({ ...prev, loading: false, error: 'Ошибка чтения: ' + err.message, isLoaded: false }));
      setErrorMsg('Ошибка чтения файла: убедитесь, что это корректный Excel/CSV. ' + err.message);
    }
  };

  const handleLoadLink = async (source, setSource, snapshot = false) => {
    setErrorMsg('');
    setSource((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const parsed = await loadFromLink(source.link);
      applyParsed(parsed, setSource, snapshot);
    } catch (err) {
      setSource((prev) => ({ ...prev, loading: false, error: err.message, isLoaded: false }));
      setErrorMsg(err.message);
    }
  };

  const handleSheetChange = (sheetName, setSource, snapshot = false) => {
    setSource((prev) => {
      const next = {
        ...prev,
        activeSheet: sheetName,
        data: prev.allData[sheetName]?.data || [],
        columns: prev.allData[sheetName]?.columns || [],
      };
      if (snapshot) {
        setSource1Snapshot({
          data: next.data,
          columns: next.columns,
          sheets: next.sheets,
          activeSheet: next.activeSheet,
          allData: next.allData,
        });
      }
      return next;
    });
  };

  const restoreOriginal = () => {
    if (!source1Snapshot) return;
    setSource1((prev) => ({ ...prev, ...source1Snapshot, isLoaded: true }));
    setResultData([]);
    setSuccessMsg('Восстановлена исходная загрузка основной базы');
  };

  const executeMapping = () => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (activeRule !== 7 && !source1.isLoaded) {
        setErrorMsg('Сначала загрузите основную базу на шаге 1');
        return;
      }

      let config;
      if (activeRule === 1) {
        config = {
          mode: enrichMode,
          targetCol: enrichTargetCol,
          pullCols: enrichPullCols.map((p) => p.col).filter(Boolean),
          keys: enrichKeys,
          rules: enrichRules,
        };
      } else if (activeRule === 2) {
        config = { keys: allocKeys, sumCol: allocSumCol, driverCol: allocDriverCol };
      } else if (activeRule === 3) {
        config = { sourceCol: mapSourceCol, rules: mapRules };
      } else if (activeRule === 4) {
        config = { rules: elimRules, action: elimAction };
      } else if (activeRule === 5) {
        config = { itemCol: aggItemCol, sumCol: aggSumCol, groupCols: aggGroupCols, groups: aggGroups };
      } else if (activeRule === 6) {
        config = {
          rules: accrualRules,
          action: accrualAction,
          months: accrualMonths,
          dateCol: accrualDateCol,
          dateVal: accrualDateVal,
          sumCol: accrualSumCol,
        };
      } else if (activeRule === 7) {
        config = { opsCol, virtRules };
      } else if (activeRule === 8) {
        config = { sumCol: revalSumCol, rate: revalRate };
      }

      const finalData = runRule(activeRule, {
        source1: source1.data,
        source2: source2.data,
        columns: source1.columns,
        opsData: opsSource.data,
        config,
      });

      setResultData(finalData);
      if (chainEnabled && activeRule !== 7) {
        const cols = columnsFromData(finalData);
        setSource1((prev) => ({
          ...prev,
          data: finalData,
          columns: cols,
          allData: {
            ...prev.allData,
            [prev.activeSheet || 'Результат']: { data: finalData, columns: cols },
          },
        }));
      }
      setStep(3);
      setSuccessMsg(`Успешно обработано строк: ${finalData.length}`);
    } catch (err) {
      setErrorMsg(err.message || String(err));
    }
  };

  const navBtn = (n, label) => (
    <button
      type="button"
      onClick={() => setStep(n)}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold ${
        step === n ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-100'
      }`}
    >
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${step === n ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {n}
      </div>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-indigo-200 shadow-md">
            <Zap className="text-white w-5 h-5" />
          </div>
          <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-purple-600 tracking-tight">
            Turbohub ETL
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-64 flex-shrink-0 flex flex-col gap-2">
          {navBtn(1, 'Загрузка баз')}
          {navBtn(2, 'Библиотека правил')}
          {navBtn(3, 'Результат')}
        </div>

        <div className="flex-grow bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 min-h-[600px] w-full overflow-hidden">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold flex items-center gap-3 shadow-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0" /> {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-xl border border-green-200 font-bold flex items-center gap-3 shadow-sm">
              <Check className="w-5 h-5 flex-shrink-0" /> {successMsg}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <h2 className="text-2xl font-black text-slate-800">Шаг 1. Основная база данных (Источник 1)</h2>
              <FileSource
                source={source1}
                onFile={(file) => processFile(file, setSource1, true)}
                onLink={(kind, value) => {
                  if (kind === 'link') setSource1((prev) => ({ ...prev, link: value }));
                  else handleLoadLink(source1, setSource1, true);
                }}
              />
              <LoadedBadge source={source1} onSheetChange={(name) => handleSheetChange(name, setSource1, true)} />
              {source1.isLoaded && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-700">Предпросмотр</h3>
                    {source1Snapshot && (
                      <button type="button" onClick={restoreOriginal} className="text-sm font-bold text-indigo-600 hover:underline">
                        Сбросить к исходной загрузке
                      </button>
                    )}
                  </div>
                  <DataPreview data={source1.data} columns={source1.columns} />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (source1.isLoaded) setStep(2);
                  else setErrorMsg('Сначала загрузите данные');
                }}
                className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition flex items-center justify-center gap-2 text-lg mt-8"
              >
                Перейти к библиотеке правил <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="h-full flex flex-col">
              {!activeRule ? (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <h2 className="text-2xl font-black text-slate-800">Библиотека правил трансформации</h2>
                    <label className="bg-indigo-50 text-indigo-800 px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
                      <input type="checkbox" checked={chainEnabled} onChange={(e) => setChainEnabled(e.target.checked)} />
                      Цепочка: результат становится новой основной базой
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {RULES.map((rule) => (
                      <button
                        key={rule.id}
                        type="button"
                        onClick={() => setActiveRule(rule.id)}
                        className={`p-6 border border-slate-200 rounded-2xl ${rule.border} hover:shadow-lg transition-all text-left bg-white flex flex-col gap-4 group`}
                      >
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${rule.bg} ${rule.color} group-hover:scale-110 transition-transform shadow-sm`}>
                          <rule.icon className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800 text-lg mb-1 group-hover:text-indigo-700 transition-colors">{rule.name}</h3>
                          <p className="text-sm text-slate-500 leading-relaxed">{rule.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-grow flex flex-col">
                  <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
                    <button type="button" onClick={() => setActiveRule(null)} className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-bold transition w-fit bg-slate-100 hover:bg-indigo-50 px-4 py-2 rounded-lg">
                      <ArrowRight className="w-4 h-4 rotate-180" /> Назад к списку правил
                    </button>
                  </div>

                  <div className="flex-grow overflow-x-auto">
                    {activeRule === 1 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Search className="text-indigo-500" /> Обогащение/объединение данных</h3>
                        <div className="flex flex-col sm:flex-row gap-4 mb-4">
                          {[
                            ['rules', 'Условная логика (каскад правил)'],
                            ['vlookup', 'Сопоставление баз (объединение)'],
                          ].map(([value, label]) => (
                            <label key={value} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer flex-1 transition ${enrichMode === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                              <input type="radio" className="hidden" checked={enrichMode === value} onChange={() => setEnrichMode(value)} />
                              <span className="font-bold text-sm text-slate-800">{label}</span>
                            </label>
                          ))}
                        </div>
                        {enrichMode === 'vlookup' ? (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                                <h4 className="font-bold text-slate-800 text-sm mb-1">Основной источник (Источник 1)</h4>
                                {source1.isLoaded ? (
                                  <p className="text-xs font-bold text-green-700">Загружен: {source1.data.length} строк · {source1.columns.length} колонок</p>
                                ) : (
                                  <p className="text-xs font-bold text-red-600">Загрузите основную базу на шаге 1</p>
                                )}
                              </div>
                              <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                                <h4 className="font-bold text-slate-800 text-sm mb-1">Источник для объединения (Источник 2)</h4>
                                {source2.isLoaded ? (
                                  <p className="text-xs font-bold text-green-700">Загружен: {source2.data.length} строк · {source2.columns.length} колонок</p>
                                ) : (
                                  <p className="text-xs text-slate-500 font-medium">Загрузите файл или ссылку ниже</p>
                                )}
                              </div>
                            </div>
                            <FileSource compact source={source2} title="Загрузите источник для объединения (Источник 2)" onFile={(file) => processFile(file, setSource2)} onLink={(kind, value) => {
                              if (kind === 'link') setSource2((prev) => ({ ...prev, link: value }));
                              else handleLoadLink(source2, setSource2);
                            }} />
                            <LoadedBadge source={source2} onSheetChange={(name) => handleSheetChange(name, setSource2)} />
                            {source2.isLoaded && (
                              <>
                                <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <h4 className="font-bold text-slate-800 text-sm">Критерии связывания баз</h4>
                                    <span className="text-xs text-slate-400 font-medium">Колонка А (Источник 1) ↔ Колонка Б (Источник 2)</span>
                                  </div>
                                  {enrichKeys.map((k, i) => (
                                    <div key={k.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                                      <div className="flex flex-col md:flex-row gap-2 md:items-center">
                                        {i > 0 ? (
                                          <select value={k.logic} onChange={(e) => updateEnrichKey(k.id, { logic: e.target.value })} className="w-full md:w-20 border-slate-300 rounded p-2 text-sm bg-white font-bold text-indigo-600">
                                            <option value="AND">И</option>
                                            <option value="OR">ИЛИ</option>
                                          </select>
                                        ) : (
                                          <span className="w-full md:w-20 text-xs font-bold text-slate-400 md:text-center">Критерий 1</span>
                                        )}
                                        <select value={k.k1} onChange={(e) => updateEnrichKey(k.id, { k1: e.target.value })} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white font-medium">
                                          <option value="">Колонка из Источника 1...</option>
                                          {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <span className="text-slate-400 font-bold text-center px-1">↔</span>
                                        <select value={k.k2} onChange={(e) => updateEnrichKey(k.id, { k2: e.target.value })} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white font-medium">
                                          <option value="">Колонка из Источника 2...</option>
                                          {source2.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        {i > 0 && (
                                          <button type="button" onClick={() => setEnrichKeys((prev) => prev.filter((x) => x.id !== k.id))} className="text-slate-400 hover:text-red-500 p-2 self-center">
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-3 md:pl-[88px]">
                                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
                                          <input type="checkbox" checked={k.exact !== false} onChange={(e) => {
                                            const nextExact = e.target.checked;
                                            updateEnrichKey(k.id, { exact: nextExact });
                                            if (!nextExact && k.k1 && k.k2) openSynModal(k.id);
                                          }} />
                                          Значения в базах полностью совпадают
                                        </label>
                                        {k.exact === false && (
                                          <button type="button" disabled={!k.k1 || !k.k2} onClick={() => openSynModal(k.id)} className="text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg flex items-center gap-1">
                                            <Sliders className="w-4 h-4" /> Настроить соответствия ({(k.synonyms || []).length})
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => setEnrichKeys((prev) => [...prev, { id: Date.now(), k1: '', k2: '', logic: 'AND', exact: true, synonyms: [] }])} className="text-sm font-bold text-indigo-600">+ Добавить критерий</button>
                                </div>
                                <div className="bg-white p-4 rounded-lg border shadow-sm space-y-2">
                                  <h4 className="font-bold text-slate-800 text-sm mb-1">Что подтягиваем из Источника 2? (колонки)</h4>
                                  <p className="text-xs text-slate-400 font-medium mb-1">Добавьте одну или несколько колонок — каждая станет новой колонкой в результате.</p>
                                  {enrichPullCols.map((p, i) => (
                                    <div key={p.id} className="flex gap-2 items-center">
                                      <select value={p.col} onChange={(e) => setEnrichPullCols((prev) => prev.map((x) => x.id === p.id ? { ...x, col: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 font-bold text-indigo-700 bg-indigo-50">
                                        <option value="">Выберите колонку из Источника 2...</option>
                                        {source2.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                      </select>
                                      {i > 0 && (
                                        <button type="button" onClick={() => setEnrichPullCols((prev) => prev.filter((x) => x.id !== p.id))} className="text-slate-400 hover:text-red-500 p-2">
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => setEnrichPullCols((prev) => [...prev, { id: Date.now(), col: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить колонку</button>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                              <h4 className="font-bold text-indigo-900 text-sm mb-2">Имя новой колонки (результат):</h4>
                              <input type="text" value={enrichTargetCol} onChange={(e) => setEnrichTargetCol(e.target.value)} placeholder="Например: Проект, Категория..." className="w-full border-indigo-300 rounded p-2 font-bold text-indigo-700 bg-white shadow-sm" />
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
                              <div className="flex items-center gap-2">
                                <Upload className="w-4 h-4 text-emerald-600" />
                                <h4 className="font-bold text-emerald-900 text-sm">Загрузить правила из Excel / Google Таблицы</h4>
                              </div>
                              <p className="text-xs text-emerald-800/80 font-medium">Файл со столбцами: «Колонка», «Условие», «Значение», «Тег». Каждая строка — отдельное правило (количество не ограничено).</p>
                              <FileSource compact accent="purple" source={enrichRulesSource} title="Загрузите файл с правилами" onFile={(file) => processFile(file, setEnrichRulesSource)} onLink={(kind, value) => {
                                if (kind === 'link') setEnrichRulesSource((prev) => ({ ...prev, link: value }));
                                else handleLoadLink(enrichRulesSource, setEnrichRulesSource);
                              }} />
                              <LoadedBadge source={enrichRulesSource} onSheetChange={(name) => handleSheetChange(name, setEnrichRulesSource)} />
                              {enrichRulesSource.isLoaded && (
                                <button type="button" onClick={importEnrichRules} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-700 transition inline-flex items-center gap-2">
                                  <Upload className="w-4 h-4" /> Импортировать правила из листа «{enrichRulesSource.activeSheet || '—'}»
                                </button>
                              )}
                            </div>
                            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                              <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1.5fr_1.5fr_auto] gap-3 items-end">
                                <div>
                                  <label className="text-xs text-slate-500 font-bold mb-1 block">Если колонка:</label>
                                  <select value={enrichRuleInput.col} onChange={(e) => setEnrichRuleInput({ ...enrichRuleInput, col: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Выберите...</option>
                                    {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs text-slate-500 font-bold mb-1 block">Условие:</label>
                                  <select value={enrichRuleInput.op} onChange={(e) => setEnrichRuleInput({ ...enrichRuleInput, op: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="содержит">Содержит</option>
                                    <option value="не содержит">Не содержит</option>
                                    <option value="равно">Равно</option>
                                    <option value="не равно">Не равно</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="text-xs text-slate-500 font-bold mb-1 block">Текст:</label>
                                  <input type="text" value={enrichRuleInput.val} onChange={(e) => setEnrichRuleInput({ ...enrichRuleInput, val: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm" />
                                </div>
                                <div>
                                  <label className="text-xs text-slate-500 font-bold mb-1 block">Присвоить тег:</label>
                                  <input type="text" value={enrichRuleInput.tag} onChange={(e) => setEnrichRuleInput({ ...enrichRuleInput, tag: e.target.value })} className="w-full border-indigo-300 bg-indigo-50 rounded p-2 text-sm font-bold" />
                                </div>
                                <button type="button" onClick={() => {
                                  if (!enrichRuleInput.col || !enrichRuleInput.val || !enrichRuleInput.tag) return;
                                  setEnrichRules((prev) => [...prev, { id: Date.now(), ...enrichRuleInput }]);
                                }} className="bg-slate-800 text-white px-4 py-2 rounded font-bold text-sm h-[38px]">Добавить</button>
                              </div>
                            </div>
                            {enrichRules.length > 0 && (
                              <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden p-2 space-y-1">
                                {enrichRules.map((r) => (
                                  <div key={r.id} className="flex justify-between items-center bg-white p-2.5 rounded border border-slate-100 shadow-sm">
                                    <div className="text-sm">Если <b>[{r.col}]</b> {r.op} <b>&quot;{r.val}&quot;</b> → <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded font-bold">{r.tag}</span></div>
                                    <button type="button" onClick={() => setEnrichRules((prev) => prev.filter((x) => x.id !== r.id))} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {activeRule === 2 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Scissors className="text-indigo-500" /> Сплитование (аллокация)</h3>
                        <FileSource compact source={source2} title="Загрузите базу распределения (Источник 2)" onFile={(file) => processFile(file, setSource2)} onLink={(kind, value) => {
                          if (kind === 'link') setSource2((prev) => ({ ...prev, link: value }));
                          else handleLoadLink(source2, setSource2);
                        }} />
                        <LoadedBadge source={source2} onSheetChange={(name) => handleSheetChange(name, setSource2)} />
                        {source2.isLoaded && (
                          <>
                            <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl space-y-4">
                              <h4 className="font-bold text-slate-800 text-sm">Настройка условий распределения</h4>
                              {allocKeys.map((k, i) => (
                                <div key={k.id} className="flex flex-col md:flex-row gap-2 md:items-center">
                                  <select value={k.k1} onChange={(e) => setAllocKeys((prev) => prev.map((x) => x.id === k.id ? { ...x, k1: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Колонка из ист. 1...</option>
                                    {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <span className="text-slate-400 font-bold hidden md:inline">=</span>
                                  <select value={k.k2} onChange={(e) => setAllocKeys((prev) => prev.map((x) => x.id === k.id ? { ...x, k2: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Колонка из ист. 2...</option>
                                    {source2.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  {i > 0 && <button type="button" onClick={() => setAllocKeys((prev) => prev.filter((x) => x.id !== k.id))} className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>}
                                </div>
                              ))}
                              <button type="button" onClick={() => setAllocKeys((prev) => [...prev, { id: Date.now(), k1: '', k2: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить критерий связи</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl">
                                <h4 className="font-bold text-orange-900 text-sm mb-2">Что распределяем (ист. 1)?</h4>
                                <select value={allocSumCol} onChange={(e) => setAllocSumCol(e.target.value)} className="w-full border-orange-300 rounded p-2 bg-white font-bold text-orange-800">
                                  <option value="">Колонка с суммой...</option>
                                  {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl">
                                <h4 className="font-bold text-purple-900 text-sm mb-2">На основании чего (драйвер ист. 2)?</h4>
                                <select value={allocDriverCol} onChange={(e) => setAllocDriverCol(e.target.value)} className="w-full border-purple-300 rounded p-2 bg-white font-bold text-purple-800">
                                  <option value="">Колонка (доля, % или часы)...</option>
                                  {source2.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="bg-slate-800 p-4 rounded-xl text-white space-y-2">
                              <h4 className="font-bold text-sm text-slate-300">Формула расчета</h4>
                              <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 font-mono text-xs md:text-sm text-green-400 text-center">
                                [ {allocSumCol || 'Сумма'} ] × ( [ {allocDriverCol || 'Значение драйвера'} ] ÷ [ Сумма драйверов ] )
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {activeRule === 3 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><RefreshCcw className="text-indigo-500" /> Мэппинг</h3>
                        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                          <h4 className="font-bold text-indigo-900 text-sm mb-2">В какой колонке проводим замену?</h4>
                          <select value={mapSourceCol} onChange={(e) => setMapSourceCol(e.target.value)} className="w-full border-indigo-300 rounded-lg p-2 font-bold bg-white text-indigo-800 shadow-sm">
                            <option value="">Выберите колонку (напр. Статья затрат)...</option>
                            {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[300px]">
                          <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-col md:flex-row justify-between md:items-center gap-2">
                            <h4 className="font-bold text-slate-700 text-sm">Таблица соответствий</h4>
                            <label className="bg-green-100 text-green-800 px-3 py-1.5 rounded-md cursor-pointer hover:bg-green-200 transition font-bold text-xs flex items-center justify-center gap-2 border border-green-300 w-fit">
                              <Upload className="w-4 h-4" /> Загрузить из Excel
                              <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                try {
                                  const buffer = await file.arrayBuffer();
                                  setMapRules(parseMappingFile(buffer));
                                } catch (err) {
                                  setErrorMsg('Не удалось прочитать файл мэппинга: ' + err.message);
                                }
                              }} />
                            </label>
                          </div>
                          <div className="p-3 space-y-2 overflow-y-auto max-h-[300px]">
                            {mapRules.map((rule) => (
                              <div key={rule.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center bg-slate-50 md:bg-transparent p-2 md:p-0 rounded-md border md:border-none border-slate-200">
                                <select value={rule.src} onChange={(e) => setMapRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, src: e.target.value } : r))} className="border-slate-300 rounded p-2 text-sm bg-white font-medium w-full" disabled={!mapSourceCol}>
                                  <option value="">{mapSourceCol ? 'Выберите значение...' : 'Сначала выберите колонку выше'}</option>
                                  {mapValues.map((v) => <option key={v} value={v}>{v}</option>)}
                                </select>
                                <input type="text" value={rule.target} onChange={(e) => setMapRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, target: e.target.value } : r))} placeholder="Эталон..." className="border-indigo-200 rounded p-2 text-sm font-bold text-indigo-700 bg-indigo-50 w-full" />
                                <button type="button" onClick={() => setMapRules((prev) => prev.filter((r) => r.id !== rule.id))} className="text-slate-300 hover:text-red-500 p-2 justify-self-end"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            ))}
                          </div>
                          <div className="p-3 bg-slate-50 border-t border-slate-200">
                            <button type="button" onClick={() => setMapRules((prev) => [...prev, { id: Date.now(), src: '', target: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить пару</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeRule === 4 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Filter className="text-indigo-500" /> Элиминация</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
                          <label className={`flex-1 p-3 rounded-lg border cursor-pointer ${elimAction === 'soft' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                            <input type="radio" className="mr-2" checked={elimAction === 'soft'} onChange={() => setElimAction('soft')} />
                            <span className="font-bold text-sm">Мягкая: пометить как «Исключено»</span>
                          </label>
                          <label className={`flex-1 p-3 rounded-lg border cursor-pointer ${elimAction === 'hard' ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}>
                            <input type="radio" className="mr-2" checked={elimAction === 'hard'} onChange={() => setElimAction('hard')} />
                            <span className="font-bold text-sm">Жёсткая: удалить строки из результата</span>
                          </label>
                        </div>
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                          <h4 className="font-bold text-slate-800 text-sm mb-1">Условия фильтрации</h4>
                          {elimRules.map((rule, index) => (
                            <div key={rule.id} className="flex flex-col md:flex-row items-start md:items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                              {index > 0 ? (
                                <select value={rule.logic} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, logic: e.target.value } : r))} className="border-slate-300 rounded p-1.5 text-xs font-bold bg-white w-20 text-indigo-700">
                                  <option value="AND">И</option>
                                  <option value="OR">ИЛИ</option>
                                </select>
                              ) : <span className="w-20 text-xs font-bold text-slate-400 text-center uppercase tracking-wider hidden md:inline-block">Где</span>}
                              <select value={rule.col} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, col: e.target.value } : r))} className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="">Колонка...</option>
                                {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <select value={rule.op} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, op: e.target.value } : r))} className="w-full md:w-32 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="равно">=</option>
                                <option value="не равно">≠</option>
                                <option value="содержит">содержит</option>
                                <option value="не содержит">не содержит</option>
                              </select>
                              <input type="text" value={rule.val} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, val: e.target.value } : r))} placeholder="Значение..." className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm" />
                              {index > 0 && <button type="button" onClick={() => setElimRules((prev) => prev.filter((r) => r.id !== rule.id))} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
                            </div>
                          ))}
                          <button type="button" onClick={() => setElimRules((prev) => [...prev, { id: Date.now(), logic: 'AND', col: '', op: 'равно', val: '' }])} className="text-sm font-bold text-indigo-600 mt-2">+ Добавить условие</button>
                        </div>
                      </div>
                    )}

                    {activeRule === 5 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Sliders className="text-indigo-500" /> Агрегация</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                            <label className="font-bold text-indigo-900 text-xs uppercase mb-1 block">Где лежат элементы?</label>
                            <select value={aggItemCol} onChange={(e) => setAggItemCol(e.target.value)} className="w-full border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                              <option value="">Выберите колонку (напр. Статья)</option>
                              {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                            <label className="font-bold text-green-900 text-xs uppercase mb-1 block">Что суммировать?</label>
                            <select value={aggSumCol} onChange={(e) => setAggSumCol(e.target.value)} className="w-full border-green-200 rounded p-2 text-sm bg-white font-bold text-green-700">
                              <option value="">Выберите колонку сумм</option>
                              {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
                          <label className="font-bold text-purple-900 text-xs uppercase mb-1 block">Сохранить детализацию (группировать по):</label>
                          <div className="flex flex-wrap gap-2 items-center">
                            {aggGroupCols.map((col) => (
                              <span key={col} className="bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-sm">
                                {col} <button type="button" onClick={() => setAggGroupCols((prev) => prev.filter((c) => c !== col))} className="hover:text-purple-200">×</button>
                              </span>
                            ))}
                            <select onChange={(e) => {
                              if (e.target.value && !aggGroupCols.includes(e.target.value)) setAggGroupCols((prev) => [...prev, e.target.value]);
                              e.target.value = '';
                            }} className="border-purple-200 rounded p-1.5 text-xs bg-white w-full sm:w-48 text-purple-700 font-bold shadow-sm">
                              <option value="">+ Добавить (напр. Дата)...</option>
                              {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                          <h4 className="font-bold text-slate-800 text-sm">Создание объединённой группы</h4>
                          <input type="text" value={currentGroupName} onChange={(e) => setCurrentGroupName(e.target.value)} placeholder="Название новой группы (напр. Канцтовары)" className="w-full border-slate-300 rounded p-2 text-sm font-bold bg-slate-50" />
                          <div className="flex flex-col sm:flex-row gap-2">
                            <select value={currentItemSelect} onChange={(e) => setCurrentItemSelect(e.target.value)} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white" disabled={!aggItemCol}>
                              <option value="">{aggItemCol ? 'Выберите элементы...' : 'Сначала выберите колонку элементов выше'}</option>
                              {aggItems.map((v) => <option key={v} value={v}>{v}</option>)}
                            </select>
                            <button type="button" onClick={() => {
                              if (!currentItemSelect || currentGroupItems.includes(currentItemSelect)) return;
                              setCurrentGroupItems((prev) => [...prev, currentItemSelect]);
                              setCurrentItemSelect('');
                            }} className="bg-slate-200 text-slate-700 px-4 py-2 rounded font-bold text-sm">Включить</button>
                          </div>
                          {currentGroupItems.length > 0 && (
                            <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                              {currentGroupItems.map((item) => (
                                <span key={item} className="bg-white border border-indigo-200 text-indigo-700 text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
                                  {item} <button type="button" onClick={() => setCurrentGroupItems((prev) => prev.filter((i) => i !== item))} className="hover:text-red-500 text-slate-400">×</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <button type="button" onClick={() => {
                            if (!currentGroupName || currentGroupItems.length === 0) return;
                            setAggGroups((prev) => [...prev, { id: Date.now(), name: currentGroupName, items: currentGroupItems }]);
                            setCurrentGroupName('');
                            setCurrentGroupItems([]);
                          }} className="w-full bg-slate-800 text-white font-bold py-2 rounded-lg hover:bg-slate-700 text-sm">Создать группу</button>
                          {aggGroups.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
                              {aggGroups.map((g) => (
                                <div key={g.id} className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg flex justify-between">
                                  <div>
                                    <span className="font-bold text-indigo-900 block">{g.name}</span>
                                    <span className="text-xs text-indigo-600 line-clamp-1">{g.items.join(', ')}</span>
                                  </div>
                                  <button type="button" onClick={() => setAggGroups((prev) => prev.filter((x) => x.id !== g.id))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeRule === 6 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><CalendarClock className="text-indigo-500" /> Временные сдвиги (accruals)</h3>
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                          <h4 className="font-bold text-slate-800 text-sm mb-1">Условия фильтрации</h4>
                          {accrualRules.map((rule, index) => (
                            <div key={rule.id} className="flex flex-col md:flex-row items-start md:items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                              {index > 0 ? (
                                <select value={rule.logic} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, logic: e.target.value } : r))} className="border-slate-300 rounded p-1.5 text-xs font-bold bg-white w-20 text-indigo-700">
                                  <option value="AND">И</option>
                                  <option value="OR">ИЛИ</option>
                                </select>
                              ) : <span className="w-20 text-xs font-bold text-slate-400 text-center hidden md:inline-block">Где</span>}
                              <select value={rule.col} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, col: e.target.value } : r))} className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="">Колонка...</option>
                                {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <select value={rule.op} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, op: e.target.value } : r))} className="w-full md:w-32 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="равно">=</option>
                                <option value="содержит">содержит</option>
                                <option value="не равно">≠</option>
                                <option value="не содержит">не содержит</option>
                              </select>
                              <input type="text" value={rule.val} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, val: e.target.value } : r))} placeholder="Значение..." className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm" />
                              {index > 0 && <button type="button" onClick={() => setAccrualRules((prev) => prev.filter((r) => r.id !== rule.id))} className="text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
                            </div>
                          ))}
                          <button type="button" onClick={() => setAccrualRules((prev) => [...prev, { id: Date.now(), logic: 'AND', col: '', op: 'содержит', val: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить условие</button>
                        </div>
                        <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100 space-y-4">
                          <h4 className="font-bold text-indigo-900 text-sm">Действие:</h4>
                          <div className="flex flex-col sm:flex-row gap-4 mb-4">
                            <label className="flex items-center gap-2 bg-white p-3 rounded-lg border border-indigo-200 cursor-pointer flex-1 shadow-sm">
                              <input type="radio" checked={accrualAction === 'split'} onChange={() => setAccrualAction('split')} className="text-indigo-600" />
                              <span className="font-bold text-sm text-indigo-800">Распределить сумму на периоды (РБП)</span>
                            </label>
                            <label className="flex items-center gap-2 bg-white p-3 rounded-lg border border-indigo-200 cursor-pointer flex-1 shadow-sm">
                              <input type="radio" checked={accrualAction === 'shift'} onChange={() => setAccrualAction('shift')} className="text-indigo-600" />
                              <span className="font-bold text-sm text-indigo-800">Изменить (сдвинуть) дату</span>
                            </label>
                          </div>
                          {accrualAction === 'split' ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-sm font-bold text-indigo-800">Колонка суммы</span>
                              <select value={accrualSumCol} onChange={(e) => setAccrualSumCol(e.target.value)} className="w-full sm:w-48 border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                                <option value="">Авто (имя содержит «сумма»/sum)</option>
                                {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <span className="text-sm font-bold text-indigo-800">на</span>
                              <input type="number" min="1" max="60" value={accrualMonths} onChange={(e) => setAccrualMonths(e.target.value)} className="w-20 border-indigo-200 rounded p-2 text-center font-bold" />
                              <span className="text-sm font-bold text-indigo-800">месяцев равными долями.</span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="text-sm font-bold text-indigo-800">Установить в колонку</span>
                              <select value={accrualDateCol} onChange={(e) => setAccrualDateCol(e.target.value)} className="w-full sm:w-48 border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                                <option value="">Колонка даты...</option>
                                {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input type="date" value={accrualDateVal} onChange={(e) => setAccrualDateVal(e.target.value)} className="border-indigo-200 rounded p-2 font-bold shadow-inner" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeRule === 7 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800"><Calculator className="text-indigo-500" /> Бухгалтерские проводки (матрица Дт/Кт)</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 shadow-sm space-y-4">
                            <h4 className="font-bold text-indigo-900 text-sm">1. План счетов</h4>
                            <FileSource compact accent="indigo" source={coaSource} title="Excel или Google Sheets" onFile={(file) => processFile(file, setCoaSource)} onLink={(kind, value) => {
                              if (kind === 'link') setCoaSource((prev) => ({ ...prev, link: value }));
                              else handleLoadLink(coaSource, setCoaSource);
                            }} />
                            {coaSource.isLoaded && (
                              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                                <LoadedBadge source={coaSource} onSheetChange={(name) => handleSheetChange(name, setCoaSource)} />
                                <label className="text-xs font-bold text-slate-500 block pt-1">Где номера счетов?</label>
                                <select value={coaAccCol} onChange={(e) => setCoaAccCol(e.target.value)} className="w-full border-indigo-300 rounded p-2 text-sm font-bold bg-white text-indigo-800">
                                  <option value="">Выберите колонку...</option>
                                  {coaSource.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                          <div className="bg-purple-50 p-6 rounded-xl border border-purple-100 shadow-sm space-y-4">
                            <h4 className="font-bold text-purple-900 text-sm">2. База операций</h4>
                            <FileSource compact accent="purple" source={opsSource} title="Excel или Google Sheets" onFile={(file) => processFile(file, setOpsSource)} onLink={(kind, value) => {
                              if (kind === 'link') setOpsSource((prev) => ({ ...prev, link: value }));
                              else handleLoadLink(opsSource, setOpsSource);
                            }} />
                            {opsSource.isLoaded && (
                              <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                                <LoadedBadge source={opsSource} onSheetChange={(name) => handleSheetChange(name, setOpsSource)} />
                                <label className="text-xs font-bold text-slate-500 block pt-1">Где названия операций?</label>
                                <select value={opsCol} onChange={(e) => setOpsCol(e.target.value)} className="w-full border-purple-300 rounded p-2 text-sm font-bold bg-white text-purple-800">
                                  <option value="">Выберите колонку...</option>
                                  {opsSource.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                        {virtRules.length > 0 && (
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                            <h4 className="font-bold text-slate-900 text-sm mb-2">3. Матрица проводок:</h4>
                            <div className="grid grid-cols-[2fr_1fr_1fr] gap-4 mb-2 border-b border-slate-200 pb-2">
                              <span className="text-xs font-black text-slate-500 uppercase">Наименование операции</span>
                              <span className="text-xs font-black text-indigo-600 uppercase">Счёт Дт</span>
                              <span className="text-xs font-black text-indigo-600 uppercase">Счёт Кт</span>
                            </div>
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                              {virtRules.map((rule) => (
                                <div key={rule.id} className="grid grid-cols-[2fr_1fr_1fr] gap-4 items-center">
                                  <div className="text-sm font-bold text-slate-700 truncate" title={rule.opName}>{rule.opName}</div>
                                  <select value={rule.dt} onChange={(e) => setVirtRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, dt: e.target.value } : r))} className="border-slate-300 rounded-md p-2 bg-white text-sm font-medium" disabled={!coaAccCol}>
                                    <option value="">Дебет...</option>
                                    {coaAccounts.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                  <select value={rule.ct} onChange={(e) => setVirtRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, ct: e.target.value } : r))} className="border-slate-300 rounded-md p-2 bg-white text-sm font-medium" disabled={!coaAccCol}>
                                    <option value="">Кредит...</option>
                                    {coaAccounts.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeRule === 8 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><TrendingUp className="text-indigo-500" /> Переоценка</h3>
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                          <div>
                            <label className="font-bold text-sm text-slate-700 mb-1 block">Колонка с суммой для пересчёта:</label>
                            <select value={revalSumCol} onChange={(e) => setRevalSumCol(e.target.value)} className="w-full border-slate-300 rounded p-2">
                              <option value="">Выберите колонку...</option>
                              {source1.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="font-bold text-sm text-slate-700 mb-1 block">Управленческий коэффициент (множитель):</label>
                            <input type="number" step="0.01" value={revalRate} onChange={(e) => setRevalRate(e.target.value)} className="w-full border-slate-300 rounded p-2 font-bold text-indigo-600 bg-indigo-50" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {activeRule && (
                    <div className="mt-8 pt-6 border-t border-slate-200 flex justify-end">
                      <button type="button" onClick={executeMapping} className="bg-indigo-600 text-white px-8 py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 flex items-center gap-2 text-lg w-full md:w-auto justify-center">
                        Сохранить и применить правило <ArrowRight className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 py-6">
              {resultData.length > 0 ? (
                <>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                      <Check className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-3xl font-black text-slate-800 mb-2">Трансформация успешно завершена</h2>
                    <p className="text-slate-500 font-medium mb-8">
                      Система сгенерировала <span className="font-bold text-slate-800">{resultData.length}</span> строк по заданным правилам.
                    </p>
                    <button type="button" onClick={() => {
                      try {
                        exportToExcel(resultData);
                      } catch (err) {
                        setErrorMsg(err.message);
                      }
                    }} className="bg-green-600 text-white px-10 py-4 rounded-xl font-black text-lg hover:bg-green-700 transition shadow-lg shadow-green-200 inline-flex items-center gap-3">
                      <Save className="w-6 h-6" /> Скачать итоговый Excel
                    </button>
                  </div>
                  <DataPreview data={resultData} columns={resultColumns} maxRows={50} />
                  <div className="text-center">
                    <button type="button" onClick={() => setStep(2)} className="text-indigo-600 font-bold hover:underline text-sm">Вернуться к настройке правил</button>
                  </div>
                </>
              ) : (
                <div className="text-slate-500 font-medium text-center py-12">Нет данных для экспорта. Выполните трансформацию на шаге 2.</div>
              )}
            </div>
          )}
        </div>
      </main>

      {synKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSynModalKeyId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <div>
                <h3 className="text-lg font-black text-slate-800">Соответствие значений (словарь синонимов)</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  <b>{synKey.k1 || '—'}</b> (Источник 1) ↔ <b>{synKey.k2 || '—'}</b> (Источник 2)
                </p>
              </div>
              <button type="button" onClick={() => setSynModalKeyId(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2">×</button>
            </div>
            <div className="p-5 space-y-5">
              {!synKey.k1 || !synKey.k2 ? (
                <p className="text-sm font-bold text-red-600">Сначала выберите обе колонки для этого критерия.</p>
              ) : (
                <>
                  <p className="text-xs text-slate-500 font-medium bg-slate-50 border border-slate-200 rounded-lg p-3">
                    Свяжите значения, которые означают одно и то же, но записаны по-разному (например, «Мск» → «г. Москва»). Строки будут считаться совпадающими только для заданных пар.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1 block">Значение из Источника 1 ({synKey.k1})</label>
                      <input type="text" value={synSearchA} onChange={(e) => setSynSearchA(e.target.value)} placeholder="Поиск по значениям..." className="w-full border-slate-300 rounded p-2 text-sm mb-2" />
                      <div className="border border-slate-300 rounded max-h-40 overflow-y-auto bg-white">
                        {synValuesA.filter((v) => v.toLowerCase().includes(synSearchA.toLowerCase())).map((v) => (
                          <button type="button" key={v} onClick={() => setSynInputA(v)} className={`w-full text-left px-3 py-1.5 text-sm border-b border-slate-50 last:border-0 ${synInputA === v ? 'bg-indigo-100 text-indigo-800 font-bold' : 'hover:bg-slate-50 text-slate-700'}`}>
                            {v}
                          </button>
                        ))}
                        {synValuesA.filter((v) => v.toLowerCase().includes(synSearchA.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-400 font-medium">Нет значений</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-500 mb-1 block">Значение из Источника 2 ({synKey.k2})</label>
                      <input type="text" value={synSearchB} onChange={(e) => setSynSearchB(e.target.value)} placeholder="Поиск по значениям..." className="w-full border-slate-300 rounded p-2 text-sm mb-2" />
                      <div className="border border-slate-300 rounded max-h-40 overflow-y-auto bg-white">
                        {synValuesB.filter((v) => v.toLowerCase().includes(synSearchB.toLowerCase())).map((v) => (
                          <button type="button" key={v} onClick={() => setSynInputB(v)} className={`w-full text-left px-3 py-1.5 text-sm border-b border-slate-50 last:border-0 ${synInputB === v ? 'bg-indigo-100 text-indigo-800 font-bold' : 'hover:bg-slate-50 text-slate-700'}`}>
                            {v}
                          </button>
                        ))}
                        {synValuesB.filter((v) => v.toLowerCase().includes(synSearchB.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-xs text-slate-400 font-medium">Нет значений</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={addSynonym} disabled={!synInputA || !synInputB} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      + Добавить соответствие
                    </button>
                    <label className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm cursor-pointer inline-flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Загрузить файл соответствий
                      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { loadSynonymFile(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                    {(synInputA || synInputB) && (
                      <span className="text-sm text-slate-500 font-medium">«{synInputA || '…'}» → «{synInputB || '…'}»</span>
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm mb-2">Словарь соответствий ({(synKey.synonyms || []).length})</h4>
                    {(synKey.synonyms || []).length === 0 ? (
                      <p className="text-sm text-slate-400 font-medium">Пока нет соответствий. Добавьте пары вручную или загрузите файл.</p>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-60 overflow-y-auto">
                        {(synKey.synonyms || []).map((p, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 bg-white text-sm">
                            <span className="flex-1 truncate"><b className="text-slate-700">{p.a}</b> <span className="text-slate-400">→</span> <b className="text-indigo-700">{p.b}</b></span>
                            <button type="button" onClick={() => removeSynonym(idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end sticky bottom-0 bg-white">
              <button type="button" onClick={() => setSynModalKeyId(null)} className="bg-slate-800 text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-700">Готово</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
