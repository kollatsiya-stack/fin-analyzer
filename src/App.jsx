import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Calculator,
  CalendarClock,
  Check,
  Database,
  ExternalLink,
  Filter,
  FileBarChart,
  Layers,
  RefreshCcw,
  Save,
  Scissors,
  Search,
  Sliders,
  Table,
  Trash2,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import DataPreview from './components/DataPreview.jsx';
import SourcePicker from './components/SourcePicker.jsx';
import SourceUploader from './components/SourceUploader.jsx';
import RulesRegistry from './components/RulesRegistry.jsx';
import ReportsPanel from './components/ReportsPanel.jsx';
import { columnsFromData, uniqueSorted } from './lib/parse.js';
import {
  exportToExcel,
  loadFromLink,
  pairsFromRows,
  parseMappingFile,
  readFileAsWorkbook,
} from './lib/excel.js';
import { mergeSources, rulesFromRows, runRule } from './lib/etl.js';
import { exportToGoogleSheet } from './lib/gsheets.js';
import {
  detectFileType,
  getSource,
  makeSource,
  removeSource,
  sourcesFromWorkbook,
  typeLabel,
  uniqueSourceName,
  upsertSource,
} from './lib/sources.js';
import {
  detectSubcontoColumns,
  expandSubconto,
  listSubcontoDictionaries,
} from './lib/subconto.js';
import {
  duplicateRule,
  loadRulesFromStorage,
  makeTransformRule,
  removeRule,
  reorderRules,
  saveRulesToStorage,
  sortRules,
  toggleRule,
  upsertRule,
} from './lib/transformRules.js';

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

  // --- Unified sources registry ---
  const [sources, setSources] = useState([]);
  const [primarySourceId, setPrimarySourceId] = useState(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewId, setPreviewId] = useState(null);

  // Step 2 — subconto
  const [postingsId, setPostingsId] = useState(null);
  const [coaId, setCoaId] = useState(null);
  const [subcontoMap, setSubcontoMap] = useState({});
  const [subcontoSelectedIds, setSubcontoSelectedIds] = useState([]);
  const [subcontoDictSourceIds, setSubcontoDictSourceIds] = useState({});
  const [subcontoPreview, setSubcontoPreview] = useState(null);

  // Step 3 — ETL
  const [activeRule, setActiveRule] = useState(null);
  const [resultData, setResultData] = useState([]);
  const [showResult, setShowResult] = useState(false);
  const [chainEnabled, setChainEnabled] = useState(true);
  const [lookupSourceId, setLookupSourceId] = useState(null);
  const [rulesTableId, setRulesTableId] = useState(null);
  const [mapTableId, setMapTableId] = useState(null);
  const [opsSourceId, setOpsSourceId] = useState(null);
  const [coaMatrixId, setCoaMatrixId] = useState(null);
  const [transformRules, setTransformRules] = useState(() => loadRulesFromStorage());
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleNameDraft, setRuleNameDraft] = useState('');

  const [enrichMode, setEnrichMode] = useState('rules');
  const [enrichTargetCol, setEnrichTargetCol] = useState('');
  const [enrichKeys, setEnrichKeys] = useState([
    { id: 1, k1: '', k2: '', logic: 'AND', exact: true, synonyms: [] },
  ]);
  const [enrichPullCols, setEnrichPullCols] = useState([{ id: 1, col: '' }]);
  const [enrichUnmatched, setEnrichUnmatched] = useState('keep');
  const [enrichConflicts, setEnrichConflicts] = useState([]);
  const [enrichResolutions, setEnrichResolutions] = useState({});
  const [enrichMergeSnapshot, setEnrichMergeSnapshot] = useState(null);
  const [enrichRuleInput, setEnrichRuleInput] = useState({ col: '', op: 'содержит', val: '', tag: '' });
  const [enrichRules, setEnrichRules] = useState([]);

  const [synModalKeyId, setSynModalKeyId] = useState(null);
  const [synInputA, setSynInputA] = useState('');
  const [synInputB, setSynInputB] = useState('');
  const [synSearchA, setSynSearchA] = useState('');
  const [synSearchB, setSynSearchB] = useState('');

  const [allocKeys, setAllocKeys] = useState([{ id: 1, k1: '', k2: '' }]);
  const [allocSumCol, setAllocSumCol] = useState('');
  const [allocDriverCol, setAllocDriverCol] = useState('');
  const [allocCarryCols, setAllocCarryCols] = useState([{ id: 1, col: '' }]);
  const [allocAddFormula, setAllocAddFormula] = useState(true);
  const [allocAggregate, setAllocAggregate] = useState(false);

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

  const [gsheetClientId, setGsheetClientId] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('gsheet_client_id');
      if (saved) return saved;
    }
    return import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';
  });
  const [showGsheetConfig, setShowGsheetConfig] = useState(false);
  const [gsheetBusy, setGsheetBusy] = useState(false);
  const [gsheetUrl, setGsheetUrl] = useState('');
  const gsheetConfigRef = useRef(null);
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const primary = getSource(sources, primarySourceId);
  const lookup = getSource(sources, lookupSourceId);
  const postings = getSource(sources, postingsId);
  const coaTable = getSource(sources, coaId);
  const opsTable = getSource(sources, opsSourceId);
  const coaMatrix = getSource(sources, coaMatrixId);
  const rulesTable = getSource(sources, rulesTableId);
  const preview = getSource(sources, previewId) || primary;

  const primaryColumns = primary?.columns || [];
  const lookupColumns = lookup?.columns || [];
  const resultColumns = useMemo(() => columnsFromData(resultData), [resultData]);

  const mapValues = useMemo(
    () => (mapSourceCol && primary ? uniqueSorted(primary.data.map((r) => r[mapSourceCol])) : []),
    [mapSourceCol, primary]
  );
  const aggItems = useMemo(
    () => (aggItemCol && primary ? uniqueSorted(primary.data.map((r) => r[aggItemCol])) : []),
    [aggItemCol, primary]
  );
  const coaAccounts = useMemo(
    () => (coaAccCol && coaMatrix ? uniqueSorted(coaMatrix.data.map((r) => r[coaAccCol])) : []),
    [coaAccCol, coaMatrix]
  );

  const updateEnrichKey = (id, patch) =>
    setEnrichKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  const synKey = enrichKeys.find((k) => k.id === synModalKeyId) || null;
  const synValuesA = useMemo(
    () => (synKey?.k1 && primary ? uniqueSorted(primary.data.map((r) => r[synKey.k1])) : []),
    [synKey?.k1, primary]
  );
  const synValuesB = useMemo(
    () => (synKey?.k2 && lookup ? uniqueSorted(lookup.data.map((r) => r[synKey.k2])) : []),
    [synKey?.k2, lookup]
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
        setErrorMsg('В файле соответствий не найдено пар (нужны минимум две колонки)');
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

  const registerParsed = (parsed, { type, origin, namePrefix }) => {
    const created = sourcesFromWorkbook(parsed, {
      type,
      origin,
      namePrefix,
      existing: sources,
    });
    setSources((prev) => [...prev, ...created]);
    if (!primarySourceId && created[0]) {
      setPrimarySourceId(created[0].id);
      setPreviewId(created[0].id);
    } else if (created[0]) {
      setPreviewId(created[0].id);
    }
    setSuccessMsg(`В реестр добавлено таблиц: ${created.length}`);
    setErrorMsg('');
    setUploadName('');
    return created;
  };

  const handleUploadFile = async (file, nameHint) => {
    if (!file) return;
    setUploadLoading(true);
    setUploadError('');
    setErrorMsg('');
    try {
      const parsed = await readFileAsWorkbook(file);
      const type = detectFileType(file.name);
      const prefix = (nameHint || '').trim() || file.name.replace(/\.[^.]+$/, '');
      registerParsed(parsed, { type, origin: file.name, namePrefix: prefix });
    } catch (err) {
      setUploadError('Ошибка чтения: ' + err.message);
      setErrorMsg('Ошибка чтения файла: ' + err.message);
    } finally {
      setUploadLoading(false);
    }
  };

  const handleUploadLink = async (link, nameHint) => {
    setUploadLoading(true);
    setUploadError('');
    setErrorMsg('');
    try {
      const parsed = await loadFromLink(link);
      const prefix = (nameHint || '').trim() || 'Google_Sheets';
      registerParsed(parsed, { type: 'gsheet', origin: link, namePrefix: prefix });
    } catch (err) {
      setUploadError(err.message);
      setErrorMsg(err.message);
    } finally {
      setUploadLoading(false);
    }
  };

  const renameSource = (id, name) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s))
    );
  };

  const deleteSource = (id) => {
    setSources((prev) => removeSource(prev, id));
    if (primarySourceId === id) setPrimarySourceId(null);
    if (previewId === id) setPreviewId(null);
    if (postingsId === id) setPostingsId(null);
    if (coaId === id) setCoaId(null);
    if (lookupSourceId === id) setLookupSourceId(null);
    if (opsSourceId === id) setOpsSourceId(null);
    if (coaMatrixId === id) setCoaMatrixId(null);
  };

  const subcontoDictionaries = useMemo(() => {
    if (!postings || !coaTable) return [];
    try {
      return listSubcontoDictionaries({
        postings: postings.data,
        coa: coaTable.data,
        config: subcontoMap,
      });
    } catch {
      return [];
    }
  }, [postings, coaTable, subcontoMap]);

  // Auto-detect subconto columns when tables change; refresh dictionary checklist.
  useEffect(() => {
    if (!postings || !coaTable) {
      setSubcontoMap({});
      setSubcontoSelectedIds([]);
      return;
    }
    setSubcontoMap(detectSubcontoColumns(postings.columns, coaTable.columns));
  }, [postingsId, coaId]);

  useEffect(() => {
    if (!subcontoDictionaries.length) {
      setSubcontoSelectedIds([]);
      return;
    }
    setSubcontoSelectedIds((prev) => {
      const valid = new Set(subcontoDictionaries.map((d) => d.id));
      const kept = prev.filter((id) => valid.has(id));
      // First load / empty selection → select all by default.
      return kept.length ? kept : subcontoDictionaries.map((d) => d.id);
    });
  }, [subcontoDictionaries]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    if (gsheetClientId) localStorage.setItem('gsheet_client_id', gsheetClientId);
    else localStorage.removeItem('gsheet_client_id');
  }, [gsheetClientId]);

  useEffect(() => {
    saveRulesToStorage(transformRules);
  }, [transformRules]);

  const captureRuleBindings = () => ({
    primarySourceId,
    lookupSourceId,
    opsSourceId,
    coaMatrixId,
    rulesTableId,
    mapTableId,
  });

  const captureRuleConfig = () => {
    if (activeRule === 1) {
      return {
        mode: enrichMode,
        targetCol: enrichTargetCol,
        pullCols: enrichPullCols.map((p) => p.col).filter(Boolean),
        unmatchedAction: enrichUnmatched,
        keys: enrichKeys,
        rules: enrichRules,
      };
    }
    if (activeRule === 2) {
      return {
        keys: allocKeys,
        sumCol: allocSumCol,
        driverCol: allocDriverCol,
        carryCols: allocCarryCols.map((p) => p.col).filter(Boolean),
        addFormula: allocAddFormula,
        aggregateSource: allocAggregate,
      };
    }
    if (activeRule === 3) return { sourceCol: mapSourceCol, rules: mapRules };
    if (activeRule === 4) return { rules: elimRules, action: elimAction };
    if (activeRule === 5) {
      return { itemCol: aggItemCol, sumCol: aggSumCol, groupCols: aggGroupCols, groups: aggGroups };
    }
    if (activeRule === 6) {
      return {
        rules: accrualRules,
        action: accrualAction,
        months: accrualMonths,
        dateCol: accrualDateCol,
        dateVal: accrualDateVal,
        sumCol: accrualSumCol,
      };
    }
    if (activeRule === 7) return { opsCol, virtRules };
    if (activeRule === 8) return { sumCol: revalSumCol, rate: revalRate };
    return {};
  };

  const saveCurrentAsRule = () => {
    if (!activeRule) return;
    const name =
      ruleNameDraft.trim() ||
      `${RULES.find((r) => r.id === activeRule)?.name || 'Правило'} ${new Date().toLocaleString('ru-RU')}`;
    const base = makeTransformRule({
      id: editingRuleId || undefined,
      name,
      toolId: activeRule,
      config: captureRuleConfig(),
      bindings: captureRuleBindings(),
      order: editingRuleId
        ? transformRules.find((r) => r.id === editingRuleId)?.order || transformRules.length + 1
        : transformRules.length + 1,
    });
    setTransformRules((prev) => upsertRule(prev, base));
    setEditingRuleId(base.id);
    setRuleNameDraft(base.name);
    setSuccessMsg(`Правило «${base.name}» сохранено в реестре`);
  };

  const applyRuleToForm = (rule) => {
    setActiveRule(rule.toolId);
    setEditingRuleId(rule.id);
    setRuleNameDraft(rule.name);
    setShowResult(false);
    const b = rule.bindings || {};
    if (b.primarySourceId) setPrimarySourceId(b.primarySourceId);
    if (b.lookupSourceId) setLookupSourceId(b.lookupSourceId);
    if (b.opsSourceId) setOpsSourceId(b.opsSourceId);
    if (b.coaMatrixId) setCoaMatrixId(b.coaMatrixId);
    if (b.rulesTableId) setRulesTableId(b.rulesTableId);
    if (b.mapTableId) setMapTableId(b.mapTableId);
    const c = rule.config || {};
    if (rule.toolId === 1) {
      setEnrichMode(c.mode || 'rules');
      setEnrichTargetCol(c.targetCol || '');
      setEnrichPullCols(
        (c.pullCols || []).length
          ? c.pullCols.map((col, i) => ({ id: i + 1, col }))
          : [{ id: 1, col: '' }]
      );
      setEnrichUnmatched(c.unmatchedAction || 'keep');
      setEnrichKeys(c.keys?.length ? c.keys : [{ id: 1, k1: '', k2: '', logic: 'AND', exact: true, synonyms: [] }]);
      setEnrichRules(c.rules || []);
    } else if (rule.toolId === 2) {
      setAllocKeys(c.keys?.length ? c.keys : [{ id: 1, k1: '', k2: '' }]);
      setAllocSumCol(c.sumCol || '');
      setAllocDriverCol(c.driverCol || '');
      setAllocCarryCols(
        (c.carryCols || []).length
          ? c.carryCols.map((col, i) => ({ id: i + 1, col }))
          : [{ id: 1, col: '' }]
      );
      setAllocAddFormula(c.addFormula !== false);
      setAllocAggregate(!!c.aggregateSource);
    } else if (rule.toolId === 3) {
      setMapSourceCol(c.sourceCol || '');
      setMapRules(c.rules?.length ? c.rules : [{ id: 1, src: '', target: '' }]);
    } else if (rule.toolId === 4) {
      setElimRules(c.rules?.length ? c.rules : [{ id: 1, logic: 'AND', col: '', op: 'равно', val: '' }]);
      setElimAction(c.action || 'soft');
    } else if (rule.toolId === 5) {
      setAggItemCol(c.itemCol || '');
      setAggSumCol(c.sumCol || '');
      setAggGroupCols(c.groupCols || []);
      setAggGroups(c.groups || []);
    } else if (rule.toolId === 6) {
      setAccrualRules(c.rules?.length ? c.rules : [{ id: 1, logic: 'AND', col: '', op: 'содержит', val: '' }]);
      setAccrualAction(c.action || 'split');
      setAccrualMonths(c.months || '12');
      setAccrualDateCol(c.dateCol || '');
      setAccrualDateVal(c.dateVal || '');
      setAccrualSumCol(c.sumCol || '');
    } else if (rule.toolId === 7) {
      setOpsCol(c.opsCol || '');
      setVirtRules(c.virtRules || []);
    } else if (rule.toolId === 8) {
      setRevalSumCol(c.sumCol || '');
      setRevalRate(c.rate || '1.2');
    }
    setSuccessMsg(`Загружено правило «${rule.name}» — можно изменить и прогнать`);
  };

  const runSavedRule = (rule) => {
    applyRuleToForm(rule);
    try {
      executeMappingFromRule(rule);
    } catch (err) {
      setErrorMsg(err.message || String(err));
    }
  };

  const executeMappingFromRule = (rule) => {
    setErrorMsg('');
    setSuccessMsg('');
    const b = rule.bindings || {};
    const primarySrc = getSource(sources, b.primarySourceId || primarySourceId);
    const lookupSrc = getSource(sources, b.lookupSourceId || lookupSourceId);
    const opsSrc = getSource(sources, b.opsSourceId || opsSourceId);
    const config = rule.config || {};
    let finalData;
    if (rule.toolId === 1 && config.mode === 'vlookup') {
      if (!lookupSrc) throw new Error('В правиле не задан справочник');
      if (!primarySrc) throw new Error('В правиле не задана основная таблица');
      const snapshot = {
        sourceData: primarySrc.data,
        lookupData: lookupSrc.data,
        keys: config.keys,
        pullCols: config.pullCols,
        unmatchedAction: config.unmatchedAction,
      };
      const merged = mergeSources({ ...snapshot, resolutions: {} });
      finalData = merged.data;
      setEnrichMergeSnapshot(snapshot);
      setEnrichConflicts(merged.conflicts);
      setEnrichResolutions({});
    } else {
      finalData = runRule(rule.toolId, {
        source1: primarySrc?.data || [],
        source2: lookupSrc?.data || [],
        columns: primarySrc?.columns || [],
        opsData: opsSrc?.data || [],
        config,
      });
      setEnrichConflicts([]);
    }
    persistResult(finalData, `${rule.name}_результат`, {
      forceRegister: true,
      toolId: rule.toolId,
    });
    setSuccessMsg(`Правило «${rule.name}»: обработано строк ${finalData.length}`);
  };

  const moveRule = (id, dir) => {
    const sorted = sortRules(transformRules);
    const idx = sorted.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    setTransformRules(reorderRules(transformRules, id, sorted[swapIdx].id));
  };

  const registerReportResult = (data, label) => {
    const name = uniqueSourceName(sources, label || 'Отчёт');
    const source = makeSource({
      name,
      type: 'derived',
      data,
      columns: columnsFromData(data),
      meta: { from: 'report' },
    });
    setSources((prev) => upsertSource(prev, source));
    setSuccessMsg(`Результат отчёта сохранён в реестр как «${name}»`);
  };

  useEffect(() => {
    if (!opsCol || !opsTable?.data?.length) return;
    const uniqueOps = uniqueSorted(opsTable.data.map((r) => r[opsCol]));
    setVirtRules((prev) => {
      const prevMap = Object.fromEntries(prev.map((r) => [r.opName, r]));
      return uniqueOps.map((op, i) =>
        prevMap[op] ? { ...prevMap[op], id: i } : { id: i, opName: op, dt: '', ct: '' }
      );
    });
  }, [opsCol, opsTable]);

  const runSubcontoExpand = ({ saveToRegistry }) => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (!postings || !coaTable) {
        setErrorMsg('Выберите таблицу проводок и план счетов из реестра');
        return;
      }
      if (!subcontoSelectedIds.length) {
        setErrorMsg('Отметьте хотя бы один справочник / субконто в списке ниже');
        return;
      }
      const result = expandSubconto({
        postings: postings.data,
        coa: coaTable.data,
        config: subcontoMap,
        selectedIds: subcontoSelectedIds,
      });
      setSubcontoPreview(result);
      if (saveToRegistry) {
        const name = uniqueSourceName(sources, `${postings.name}_развернуто`);
        const source = makeSource({
          name,
          type: 'derived',
          data: result.data,
          columns: result.columns,
          origin: postings.name,
          meta: {
            from: 'subconto',
            postingsId,
            coaId,
            addedColumns: result.addedColumns,
            selectedIds: result.selectedIds,
            dictSourceIds: { ...subcontoDictSourceIds },
          },
        });
        setSources((prev) => upsertSource(prev, source));
        setPrimarySourceId(source.id);
        setPreviewId(source.id);
        setSuccessMsg(
          `Сохранено в реестр как «${name}» (${result.data.length} строк, +${result.addedColumns.length} кол., справочников: ${result.selectedIds.length})`
        );
      } else {
        setSuccessMsg(
          `Развёрнуто: ${result.data.length} строк, колонок: ${result.addedColumns.length} (справочников: ${result.selectedIds.length})`
        );
      }
    } catch (err) {
      setErrorMsg(err.message || String(err));
    }
  };

  const importEnrichRules = () => {
    if (!rulesTable) {
      setErrorMsg('Выберите таблицу с правилами из реестра');
      return;
    }
    const imported = rulesFromRows(rulesTable.data);
    if (!imported.length) {
      setErrorMsg('В таблице не найдено корректных правил (Колонка / Условие / Значение / Тег).');
      return;
    }
    setEnrichRules((prev) => [...prev, ...imported]);
    setSuccessMsg(`Импортировано правил: ${imported.length}`);
    setErrorMsg('');
  };

  const importMapRulesFromRegistry = () => {
    if (!mapTableId) return;
    const table = getSource(sources, mapTableId);
    if (!table) return;
    try {
      // Reuse parseMappingFile logic via rows
      const keys = table.columns;
      if (keys.length < 2) {
        setErrorMsg('В таблице мэппинга нужно минимум две колонки');
        return;
      }
      const c1 = keys.find((k) => k.toLowerCase().includes('исходн')) || keys[0];
      const c2 = keys.find((k) => k.toLowerCase().includes('эталон')) || keys[1];
      const next = table.data.map((r, i) => ({
        id: Date.now() + i,
        src: String(r[c1] || ''),
        target: String(r[c2] || ''),
      }));
      setMapRules(next);
      setSuccessMsg(`Загружено пар мэппинга: ${next.length}`);
    } catch (err) {
      setErrorMsg(err.message);
    }
  };

  const persistResult = (finalData, label, { forceRegister = false, toolId } = {}) => {
    const ruleId = toolId ?? activeRule;
    setResultData(finalData);
    setShowResult(true);
    setStep(3);
    if ((forceRegister || chainEnabled) && ruleId !== 7) {
      const name = uniqueSourceName(sources, label || `${primary?.name || 'Результат'}_ETL`);
      const source = makeSource({
        name,
        type: 'derived',
        data: finalData,
        columns: columnsFromData(finalData),
        origin: primary?.name || '',
        meta: { from: 'etl', ruleId },
      });
      setSources((prev) => upsertSource(prev, source));
      setPrimarySourceId(source.id);
    }
  };

  const executeMapping = () => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      if (activeRule !== 7 && !primary) {
        setErrorMsg('Сначала выберите основную таблицу в реестре (шаг 1)');
        return;
      }

      let config;
      if (activeRule === 1) {
        config = {
          mode: enrichMode,
          targetCol: enrichTargetCol,
          pullCols: enrichPullCols.map((p) => p.col).filter(Boolean),
          unmatchedAction: enrichUnmatched,
          keys: enrichKeys,
          rules: enrichRules,
        };
      } else if (activeRule === 2) {
        config = {
          keys: allocKeys,
          sumCol: allocSumCol,
          driverCol: allocDriverCol,
          carryCols: allocCarryCols.map((p) => p.col).filter(Boolean),
          addFormula: allocAddFormula,
          aggregateSource: allocAggregate,
        };
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

      let finalData;
      if (activeRule === 1 && enrichMode === 'vlookup') {
        if (!lookup) {
          setErrorMsg('Выберите таблицу-справочник из реестра');
          return;
        }
        const snapshot = {
          sourceData: primary.data,
          lookupData: lookup.data,
          keys: enrichKeys,
          pullCols: enrichPullCols.map((p) => p.col).filter(Boolean),
          unmatchedAction: enrichUnmatched,
        };
        const merged = mergeSources({ ...snapshot, resolutions: {} });
        finalData = merged.data;
        setEnrichMergeSnapshot(snapshot);
        setEnrichResolutions({});
        setEnrichConflicts(merged.conflicts);
      } else {
        if ((activeRule === 2) && !lookup) {
          setErrorMsg('Выберите базу драйверов из реестра');
          return;
        }
        if (activeRule === 7 && !opsTable) {
          setErrorMsg('Выберите таблицу операций из реестра');
          return;
        }
        finalData = runRule(activeRule, {
          source1: primary?.data || [],
          source2: lookup?.data || [],
          columns: primaryColumns,
          opsData: opsTable?.data || [],
          config,
        });
        setEnrichConflicts([]);
      }

      persistResult(finalData, `${primary?.name || 'Результат'}_${RULES.find((r) => r.id === activeRule)?.name || 'ETL'}`);
      setSuccessMsg(`Успешно обработано строк: ${finalData.length}`);
    } catch (err) {
      setErrorMsg(err.message || String(err));
    }
  };

  const resolveEnrichConflict = (conflictId, value) => {
    if (!enrichMergeSnapshot) return;
    const next = { ...enrichResolutions, [conflictId]: value };
    try {
      const merged = mergeSources({ ...enrichMergeSnapshot, resolutions: next });
      setEnrichResolutions(next);
      setEnrichConflicts(merged.conflicts);
      setResultData(merged.data);
    } catch (err) {
      setErrorMsg(err.message || String(err));
    }
  };

  const handleCreateGoogleSheet = async () => {
    setErrorMsg('');
    setGsheetUrl('');
    if (!resultData.length) {
      setErrorMsg('Нет данных для экспорта');
      return;
    }
    const clientId = gsheetClientId.trim();
    if (!clientId) {
      setShowGsheetConfig(true);
      setErrorMsg('Укажите Google OAuth Client ID в настройках ниже.');
      window.setTimeout(() => gsheetConfigRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    setGsheetBusy(true);
    try {
      const title = `Turbohub ETL — ${new Date().toLocaleString('ru-RU')}`;
      const { spreadsheetUrl } = await exportToGoogleSheet({
        clientId,
        title,
        data: resultData,
        columns: resultColumns,
      });
      setGsheetUrl(spreadsheetUrl);
      setSuccessMsg('Google Таблица успешно сформирована');
      if (spreadsheetUrl) window.open(spreadsheetUrl, '_blank', 'noopener');
    } catch (err) {
      setErrorMsg(err.message || String(err));
    } finally {
      setGsheetBusy(false);
    }
  };

  const navBtn = (n, label, icon) => (
    <button
      type="button"
      onClick={() => {
        setStep(n);
        if (n !== 3) setShowResult(false);
        if (n === 4) {
          setErrorMsg('');
          setSuccessMsg('');
        }
      }}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all font-bold ${
        step === n ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500 hover:bg-slate-100'
      }`}
    >
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm ${step === n ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {n}
      </div>
      <span className="flex items-center gap-2">{icon}{label}</span>
    </button>
  );

  const colSelect = (value, onChange, columns, placeholder) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="w-full border-slate-300 rounded p-2 text-sm bg-white font-medium">
      <option value="">{placeholder}</option>
      {(columns || []).map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
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
        <div className="text-xs font-bold text-slate-500 hidden sm:block">
          В реестре: {sources.length} · Основная: {primary?.name || '—'}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-72 flex-shrink-0 flex flex-col gap-2">
          {navBtn(1, 'Источники данных', <Database className="w-4 h-4" />)}
          {navBtn(2, 'Развёртывание субконто', <Layers className="w-4 h-4" />)}
          {navBtn(3, 'Трансформация (ETL)', <Sliders className="w-4 h-4" />)}
          {navBtn(4, 'Отчёты', <FileBarChart className="w-4 h-4" />)}
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

          {/* ========== STEP 1: Sources registry ========== */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Шаг 1. Источники данных</h2>
                <p className="text-sm text-slate-500 font-medium mt-1">
                  Загрузите все нужные таблицы один раз и выберите основную. На шагах 2–4 выбор идёт только из реестра — без повторной вставки ссылок.
                </p>
              </div>

              <SourceUploader
                defaultName={uploadName}
                onDefaultNameChange={setUploadName}
                loading={uploadLoading}
                error={uploadError}
                onFile={handleUploadFile}
                onLinkLoad={handleUploadLink}
              />

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-sm">Реестр загруженных таблиц ({sources.length})</h3>
                  {primary && (
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-1 rounded">
                      Основная: {primary.name}
                    </span>
                  )}
                </div>
                {sources.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 font-medium">Пока пусто — загрузите Excel/CSV или Google Таблицу выше.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {sources.map((s) => (
                      <li key={s.id} className={`p-4 flex flex-col lg:flex-row lg:items-center gap-3 ${primarySourceId === s.id ? 'bg-indigo-50/60' : 'bg-white'}`}>
                        <div className="flex-1 min-w-0 space-y-1">
                          <input
                            type="text"
                            value={s.name}
                            onChange={(e) => renameSource(s.id, e.target.value)}
                            className="w-full font-bold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-400 outline-none"
                          />
                          <p className="text-xs text-slate-500 font-medium truncate">
                            {typeLabel(s.type)} · {s.data.length} строк · {s.columns.length} колонок
                            {s.origin ? ` · ${s.origin}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPrimarySourceId(s.id)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${
                              primarySourceId === s.id
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50'
                            }`}
                          >
                            {primarySourceId === s.id ? '★ Основная' : 'Сделать основной'}
                          </button>
                          <button type="button" onClick={() => setPreviewId(s.id)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">
                            Превью
                          </button>
                          <button type="button" onClick={() => deleteSource(s.id)} className="text-slate-400 hover:text-red-500 p-1.5">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {preview && (
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-700">Предпросмотр: {preview.name}</h3>
                  <DataPreview data={preview.data} columns={preview.columns} />
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  if (!sources.length) setErrorMsg('Загрузите хотя бы один источник');
                  else if (!primarySourceId) setErrorMsg('Выберите основную таблицу');
                  else {
                    setErrorMsg('');
                    setStep(2);
                  }
                }}
                className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition flex items-center justify-center gap-2 text-lg"
              >
                Далее: развёртывание субконто <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ========== STEP 2: Subconto expansion ========== */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-black text-slate-800">Шаг 2. Развёртывание субконто</h2>
                <p className="text-sm text-slate-500 font-medium mt-1">
                  Выберите уже загруженные таблицы проводок и плана счетов. Позиционные субконто раскладываются в колонки «Дт: …» / «Кт: …» с учётом иерархии счетов.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SourcePicker
                  sources={sources}
                  value={postingsId}
                  onChange={setPostingsId}
                  label="Таблица проводок"
                  placeholder="Выберите проводки..."
                />
                <SourcePicker
                  sources={sources}
                  value={coaId}
                  onChange={setCoaId}
                  label="План счетов"
                  placeholder="Выберите план счетов..."
                  excludeIds={postingsId ? [postingsId] : []}
                />
              </div>

              {postings && coaTable && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <h4 className="font-bold text-slate-800 text-sm">Сопоставление колонок (можно поправить автоопределение)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[
                      ['postAccountDt', 'Счёт Дт (проводки)', postings.columns],
                      ['postAccountCt', 'Счёт Кт (проводки)', postings.columns],
                      ['postSubDt1', 'Субконто 1 Дт', postings.columns],
                      ['postSubDt2', 'Субконто 2 Дт', postings.columns],
                      ['postSubDt3', 'Субконто 3 Дт', postings.columns],
                      ['postSubCt1', 'Субконто 1 Кт', postings.columns],
                      ['postSubCt2', 'Субконто 2 Кт', postings.columns],
                      ['postSubCt3', 'Субконто 3 Кт', postings.columns],
                      ['postDivDt', 'Подразделение Дт', postings.columns],
                      ['postDivCt', 'Подразделение Кт', postings.columns],
                      ['coaAccount', 'Код счёта (план)', coaTable.columns],
                      ['coaParent', 'Родительский счёт', coaTable.columns],
                      ['coaType1', 'Вид субконто 1', coaTable.columns],
                      ['coaType2', 'Вид субконто 2', coaTable.columns],
                      ['coaType3', 'Вид субконто 3', coaTable.columns],
                    ].map(([key, label, cols]) => (
                      <div key={key}>
                        <label className="text-xs font-bold text-slate-500 mb-1 block">{label}</label>
                        {colSelect(subcontoMap[key], (v) => setSubcontoMap((m) => ({ ...m, [key]: v })), cols, '—')}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {postings && coaTable && subcontoDictionaries.length > 0 && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-indigo-900 text-sm">Какие справочники / субконто разворачивать?</h4>
                      <p className="text-xs text-indigo-800/80 font-medium mt-1">
                        Отметьте только нужные виды аналитики. Неотмеченные не попадут в результат.
                        При желании привяжите к виду таблицу-справочник из реестра (для дальнейших шагов).
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setSubcontoSelectedIds(subcontoDictionaries.map((d) => d.id))}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                      >
                        Выбрать все
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubcontoSelectedIds([])}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                      >
                        Снять все
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {subcontoDictionaries.map((dict) => {
                      const checked = subcontoSelectedIds.includes(dict.id);
                      return (
                        <div
                          key={dict.id}
                          className={`bg-white border rounded-xl p-3 flex flex-col lg:flex-row lg:items-center gap-3 ${
                            checked ? 'border-indigo-300' : 'border-slate-200 opacity-70'
                          }`}
                        >
                          <label className="flex items-start gap-3 flex-1 cursor-pointer min-w-0">
                            <input
                              type="checkbox"
                              className="mt-1 accent-indigo-600 w-4 h-4"
                              checked={checked}
                              onChange={(e) => {
                                setSubcontoSelectedIds((prev) =>
                                  e.target.checked
                                    ? [...prev, dict.id]
                                    : prev.filter((id) => id !== dict.id)
                                );
                              }}
                            />
                            <span className="min-w-0">
                              <span className="font-bold text-slate-800 text-sm block">{dict.label}</span>
                              <span className="text-xs text-slate-500 font-medium">{dict.description}</span>
                            </span>
                          </label>
                          {checked && dict.kind === 'type' && (
                            <div className="w-full lg:w-80">
                              <SourcePicker
                                sources={sources}
                                value={subcontoDictSourceIds[dict.id] || null}
                                onChange={(id) =>
                                  setSubcontoDictSourceIds((prev) => ({ ...prev, [dict.id]: id }))
                                }
                                label="Справочник из реестра (необязательно)"
                                placeholder="Не привязан"
                                excludeIds={[postingsId, coaId].filter(Boolean)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs font-bold text-indigo-800">
                    Выбрано: {subcontoSelectedIds.length} из {subcontoDictionaries.length}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => runSubcontoExpand({ saveToRegistry: false })}
                  className="flex-1 bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-700 transition"
                >
                  Развернуть (превью)
                </button>
                <button
                  type="button"
                  onClick={() => runSubcontoExpand({ saveToRegistry: true })}
                  className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-200"
                >
                  Развернуть и сохранить в реестр (_развернуто)
                </button>
              </div>

              {subcontoPreview && (
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-700">
                    Превью результата (+{subcontoPreview.addedColumns.length} кол.: {subcontoPreview.addedColumns.join(', ')})
                  </h3>
                  <DataPreview data={subcontoPreview.data} columns={subcontoPreview.columns} maxRows={30} />
                </div>
              )}

              <button
                type="button"
                onClick={() => setStep(3)}
                className="w-full bg-indigo-50 text-indigo-800 font-bold py-3 rounded-xl hover:bg-indigo-100 transition flex items-center justify-center gap-2"
              >
                Перейти к трансформации <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ========== STEP 3: ETL ========== */}
          {step === 3 && !showResult && (
            <div className="h-full flex flex-col">
              {!activeRule ? (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-2xl font-black text-slate-800">Шаг 3. Трансформация</h2>
                      <p className="text-sm text-slate-500 font-medium mt-1">
                        Основная таблица и справочники выбираются только из реестра шага 1 (и производных таблиц шага 2).
                      </p>
                    </div>
                    <label className="bg-indigo-50 text-indigo-800 px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm flex items-center gap-2">
                      <input type="checkbox" checked={chainEnabled} onChange={(e) => setChainEnabled(e.target.checked)} />
                      Цепочка: результат → новая таблица в реестре + основная
                    </label>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <SourcePicker
                      sources={sources}
                      value={primarySourceId}
                      onChange={setPrimarySourceId}
                      label="Основная таблица для трансформации"
                      placeholder="Выберите основную..."
                    />
                  </div>

                  <RulesRegistry
                    rules={transformRules}
                    sources={sources}
                    onToggle={(id) => setTransformRules((prev) => toggleRule(prev, id))}
                    onMove={moveRule}
                    onEdit={applyRuleToForm}
                    onRun={runSavedRule}
                    onCopy={(rule) =>
                      setTransformRules((prev) => [...prev, duplicateRule(rule, prev)])
                    }
                    onDelete={(id) => setTransformRules((prev) => removeRule(prev, id))}
                  />

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
                    {primary && (
                      <span className="text-xs font-bold text-slate-500">Основная: <b className="text-slate-800">{primary.name}</b></span>
                    )}
                  </div>

                  <div className="flex-grow overflow-x-auto space-y-6">
                    {activeRule === 1 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Search className="text-indigo-500" /> Обогащение/объединение данных</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
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
                              <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Основной источник" />
                              <SourcePicker sources={sources} value={lookupSourceId} onChange={setLookupSourceId} label="Источник для объединения" excludeIds={primarySourceId ? [primarySourceId] : []} />
                            </div>
                            {lookup && (
                              <>
                                <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                                  <h4 className="font-bold text-slate-800 text-sm">Критерии связывания баз</h4>
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
                                          <option value="">Колонка из основной...</option>
                                          {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                        <span className="text-slate-400 font-bold text-center px-1">↔</span>
                                        <select value={k.k2} onChange={(e) => updateEnrichKey(k.id, { k2: e.target.value })} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white font-medium">
                                          <option value="">Колонка из справочника...</option>
                                          {lookupColumns.map((c) => <option key={c} value={c}>{c}</option>)}
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
                                          <button type="button" disabled={!k.k1 || !k.k2} onClick={() => openSynModal(k.id)} className="text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 px-3 py-1.5 rounded-lg flex items-center gap-1">
                                            <Sliders className="w-4 h-4" /> Настроить соответствия ({(k.synonyms || []).length})
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  <button type="button" onClick={() => setEnrichKeys((prev) => [...prev, { id: Date.now(), k1: '', k2: '', logic: 'AND', exact: true, synonyms: [] }])} className="text-sm font-bold text-indigo-600">+ Добавить критерий</button>
                                </div>
                                <div className="bg-white p-4 rounded-lg border shadow-sm space-y-2">
                                  <h4 className="font-bold text-slate-800 text-sm">Что подтягиваем из справочника?</h4>
                                  {enrichPullCols.map((p, i) => (
                                    <div key={p.id} className="flex gap-2 items-center">
                                      <select value={p.col} onChange={(e) => setEnrichPullCols((prev) => prev.map((x) => x.id === p.id ? { ...x, col: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 font-bold text-indigo-700 bg-indigo-50">
                                        <option value="">Колонка...</option>
                                        {lookupColumns.map((c) => <option key={c} value={c}>{c}</option>)}
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
                                <div className="bg-white p-4 rounded-lg border shadow-sm">
                                  <h4 className="font-bold text-slate-800 text-sm mb-2">Строки без совпадения:</h4>
                                  <div className="flex flex-col sm:flex-row gap-3">
                                    {[
                                      ['keep', 'Оставить без новой аналитики'],
                                      ['exclude', 'Исключить из результата'],
                                    ].map(([value, label]) => (
                                      <label key={value} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer flex-1 ${enrichUnmatched === value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                                        <input type="radio" name="enrich-unmatched" className="accent-indigo-600" checked={enrichUnmatched === value} onChange={() => setEnrichUnmatched(value)} />
                                        <span className="font-bold text-sm">{label}</span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                              <h4 className="font-bold text-indigo-900 text-sm mb-2">Имя новой колонки:</h4>
                              <input type="text" value={enrichTargetCol} onChange={(e) => setEnrichTargetCol(e.target.value)} placeholder="Например: Проект, Категория..." className="w-full border-indigo-300 rounded p-2 font-bold text-indigo-700 bg-white shadow-sm" />
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
                              <h4 className="font-bold text-emerald-900 text-sm">Импорт правил из таблицы реестра</h4>
                              <SourcePicker sources={sources} value={rulesTableId} onChange={setRulesTableId} label="Таблица правил" placeholder="Колонка / Условие / Значение / Тег" />
                              {rulesTable && (
                                <button type="button" onClick={importEnrichRules} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-emerald-700 inline-flex items-center gap-2">
                                  <Upload className="w-4 h-4" /> Импортировать из «{rulesTable.name}»
                                </button>
                              )}
                            </div>
                            <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                              <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1.5fr_1.5fr_auto] gap-3 items-end">
                                <div>
                                  <label className="text-xs text-slate-500 font-bold mb-1 block">Если колонка:</label>
                                  <select value={enrichRuleInput.col} onChange={(e) => setEnrichRuleInput({ ...enrichRuleInput, col: e.target.value })} className="w-full border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Выберите...</option>
                                    {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Основная таблица (суммы)" />
                          <SourcePicker sources={sources} value={lookupSourceId} onChange={setLookupSourceId} label="База драйверов" excludeIds={primarySourceId ? [primarySourceId] : []} />
                        </div>
                        {lookup && (
                          <>
                            <div className="bg-slate-50 border border-slate-200 p-5 rounded-xl space-y-4">
                              <h4 className="font-bold text-slate-800 text-sm">Критерии связи</h4>
                              {allocKeys.map((k, i) => (
                                <div key={k.id} className="flex flex-col md:flex-row gap-2 md:items-center">
                                  <select value={k.k1} onChange={(e) => setAllocKeys((prev) => prev.map((x) => x.id === k.id ? { ...x, k1: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Колонка основной...</option>
                                    {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  <span className="text-slate-400 font-bold hidden md:inline">=</span>
                                  <select value={k.k2} onChange={(e) => setAllocKeys((prev) => prev.map((x) => x.id === k.id ? { ...x, k2: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white">
                                    <option value="">Колонка драйверов...</option>
                                    {lookupColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  {i > 0 && <button type="button" onClick={() => setAllocKeys((prev) => prev.filter((x) => x.id !== k.id))} className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>}
                                </div>
                              ))}
                              <button type="button" onClick={() => setAllocKeys((prev) => [...prev, { id: Date.now(), k1: '', k2: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить критерий связи</button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl">
                                <h4 className="font-bold text-orange-900 text-sm mb-2">Что распределяем?</h4>
                                <select value={allocSumCol} onChange={(e) => setAllocSumCol(e.target.value)} className="w-full border-orange-300 rounded p-2 bg-white font-bold text-orange-800">
                                  <option value="">Колонка с суммой...</option>
                                  {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                              <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl">
                                <h4 className="font-bold text-purple-900 text-sm mb-2">Драйвер</h4>
                                <select value={allocDriverCol} onChange={(e) => setAllocDriverCol(e.target.value)} className="w-full border-purple-300 rounded p-2 bg-white font-bold text-purple-800">
                                  <option value="">Колонка драйвера...</option>
                                  {lookupColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="bg-white p-4 rounded-lg border shadow-sm space-y-2">
                              <h4 className="font-bold text-slate-800 text-sm">Колонки драйверов для переноса</h4>
                              {allocCarryCols.map((p, i) => (
                                <div key={p.id} className="flex gap-2 items-center">
                                  <select value={p.col} onChange={(e) => setAllocCarryCols((prev) => prev.map((x) => x.id === p.id ? { ...x, col: e.target.value } : x))} className="flex-1 border-slate-300 rounded p-2 font-bold text-purple-800 bg-purple-50">
                                    <option value="">Колонка...</option>
                                    {lookupColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  {i > 0 && (
                                    <button type="button" onClick={() => setAllocCarryCols((prev) => prev.filter((x) => x.id !== p.id))} className="text-slate-400 hover:text-red-500 p-2">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              ))}
                              <button type="button" onClick={() => setAllocCarryCols((prev) => [...prev, { id: Date.now(), col: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить колонку</button>
                            </div>
                            <label className="flex items-center gap-3 bg-white p-4 rounded-lg border shadow-sm cursor-pointer">
                              <input type="checkbox" checked={allocAggregate} onChange={(e) => setAllocAggregate(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                              <span className="font-bold text-slate-800 text-sm">Сначала собрать суммы основной таблицы по критериям связи</span>
                            </label>
                            <label className="flex items-center gap-3 bg-white p-4 rounded-lg border shadow-sm cursor-pointer">
                              <input type="checkbox" checked={allocAddFormula} onChange={(e) => setAllocAddFormula(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                              <span className="font-bold text-slate-800 text-sm">Добавить колонку с формулой распределения</span>
                            </label>
                          </>
                        )}
                      </div>
                    )}

                    {activeRule === 3 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><RefreshCcw className="text-indigo-500" /> Мэппинг</h3>
                        <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Таблица для замены" />
                        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
                          <h4 className="font-bold text-indigo-900 text-sm mb-2">В какой колонке проводим замену?</h4>
                          <select value={mapSourceCol} onChange={(e) => setMapSourceCol(e.target.value)} className="w-full border-indigo-300 rounded-lg p-2 font-bold bg-white text-indigo-800 shadow-sm">
                            <option value="">Выберите колонку...</option>
                            {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
                          <h4 className="font-bold text-emerald-900 text-sm">Загрузить пары из таблицы реестра</h4>
                          <SourcePicker sources={sources} value={mapTableId} onChange={setMapTableId} label="Таблица соответствий" />
                          {mapTableId && (
                            <button type="button" onClick={importMapRulesFromRegistry} className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold text-sm">Импортировать пары</button>
                          )}
                          <label className="bg-white text-slate-700 px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-50 transition font-bold text-xs inline-flex items-center gap-2 border border-slate-200 w-fit">
                            <Upload className="w-4 h-4" /> Или разово из файла
                            <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              try {
                                setMapRules(parseMappingFile(await file.arrayBuffer()));
                              } catch (err) {
                                setErrorMsg('Не удалось прочитать файл мэппинга: ' + err.message);
                              }
                            }} />
                          </label>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 space-y-2 max-h-[300px] overflow-y-auto">
                          {mapRules.map((rule) => (
                            <div key={rule.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center">
                              <select value={rule.src} onChange={(e) => setMapRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, src: e.target.value } : r))} className="border-slate-300 rounded p-2 text-sm bg-white font-medium w-full" disabled={!mapSourceCol}>
                                <option value="">{mapSourceCol ? 'Значение...' : 'Сначала колонку'}</option>
                                {mapValues.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                              <input type="text" value={rule.target} onChange={(e) => setMapRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, target: e.target.value } : r))} placeholder="Эталон..." className="border-indigo-200 rounded p-2 text-sm font-bold text-indigo-700 bg-indigo-50 w-full" />
                              <button type="button" onClick={() => setMapRules((prev) => prev.filter((r) => r.id !== rule.id))} className="text-slate-300 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                          <button type="button" onClick={() => setMapRules((prev) => [...prev, { id: Date.now(), src: '', target: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить пару</button>
                        </div>
                      </div>
                    )}

                    {activeRule === 4 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Filter className="text-indigo-500" /> Элиминация</h3>
                        <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Таблица" />
                        <div className="flex flex-col sm:flex-row gap-4">
                          <label className={`flex-1 p-3 rounded-lg border cursor-pointer ${elimAction === 'soft' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200'}`}>
                            <input type="radio" className="mr-2" checked={elimAction === 'soft'} onChange={() => setElimAction('soft')} />
                            <span className="font-bold text-sm">Мягкая: пометить</span>
                          </label>
                          <label className={`flex-1 p-3 rounded-lg border cursor-pointer ${elimAction === 'hard' ? 'border-red-500 bg-red-50' : 'border-slate-200'}`}>
                            <input type="radio" className="mr-2" checked={elimAction === 'hard'} onChange={() => setElimAction('hard')} />
                            <span className="font-bold text-sm">Жёсткая: удалить</span>
                          </label>
                        </div>
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                          {elimRules.map((rule, index) => (
                            <div key={rule.id} className="flex flex-col md:flex-row items-start md:items-center gap-2 bg-slate-50 p-2 rounded-lg">
                              {index > 0 ? (
                                <select value={rule.logic} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, logic: e.target.value } : r))} className="border-slate-300 rounded p-1.5 text-xs font-bold bg-white w-20 text-indigo-700">
                                  <option value="AND">И</option>
                                  <option value="OR">ИЛИ</option>
                                </select>
                              ) : <span className="w-20 text-xs font-bold text-slate-400 text-center hidden md:inline-block">Где</span>}
                              <select value={rule.col} onChange={(e) => setElimRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, col: e.target.value } : r))} className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="">Колонка...</option>
                                {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
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
                          <button type="button" onClick={() => setElimRules((prev) => [...prev, { id: Date.now(), logic: 'AND', col: '', op: 'равно', val: '' }])} className="text-sm font-bold text-indigo-600">+ Добавить условие</button>
                        </div>
                      </div>
                    )}

                    {activeRule === 5 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><Sliders className="text-indigo-500" /> Агрегация</h3>
                        <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Таблица" />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                            <label className="font-bold text-indigo-900 text-xs uppercase mb-1 block">Элементы</label>
                            <select value={aggItemCol} onChange={(e) => setAggItemCol(e.target.value)} className="w-full border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                              <option value="">Колонка...</option>
                              {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                            <label className="font-bold text-green-900 text-xs uppercase mb-1 block">Сумма</label>
                            <select value={aggSumCol} onChange={(e) => setAggSumCol(e.target.value)} className="w-full border-green-200 rounded p-2 text-sm bg-white font-bold text-green-700">
                              <option value="">Колонка...</option>
                              {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
                          <label className="font-bold text-purple-900 text-xs uppercase mb-1 block">Группировать по</label>
                          <div className="flex flex-wrap gap-2 items-center">
                            {aggGroupCols.map((col) => (
                              <span key={col} className="bg-purple-600 text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1">
                                {col} <button type="button" onClick={() => setAggGroupCols((prev) => prev.filter((c) => c !== col))} className="hover:text-purple-200">×</button>
                              </span>
                            ))}
                            <select onChange={(e) => {
                              if (e.target.value && !aggGroupCols.includes(e.target.value)) setAggGroupCols((prev) => [...prev, e.target.value]);
                              e.target.value = '';
                            }} className="border-purple-200 rounded p-1.5 text-xs bg-white w-full sm:w-48 text-purple-700 font-bold">
                              <option value="">+ Добавить...</option>
                              {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                          <input type="text" value={currentGroupName} onChange={(e) => setCurrentGroupName(e.target.value)} placeholder="Название группы" className="w-full border-slate-300 rounded p-2 text-sm font-bold bg-slate-50" />
                          <div className="flex flex-col sm:flex-row gap-2">
                            <select value={currentItemSelect} onChange={(e) => setCurrentItemSelect(e.target.value)} className="flex-1 border-slate-300 rounded p-2 text-sm bg-white" disabled={!aggItemCol}>
                              <option value="">{aggItemCol ? 'Элементы...' : 'Сначала колонку элементов'}</option>
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
                          }} className="w-full bg-slate-800 text-white font-bold py-2 rounded-lg text-sm">Создать группу</button>
                          {aggGroups.map((g) => (
                            <div key={g.id} className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg flex justify-between">
                              <div>
                                <span className="font-bold text-indigo-900 block">{g.name}</span>
                                <span className="text-xs text-indigo-600">{g.items.join(', ')}</span>
                              </div>
                              <button type="button" onClick={() => setAggGroups((prev) => prev.filter((x) => x.id !== g.id))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeRule === 6 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-black flex items-center gap-2 text-slate-800"><CalendarClock className="text-indigo-500" /> Временные сдвиги</h3>
                        <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Таблица" />
                        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm space-y-3">
                          {accrualRules.map((rule, index) => (
                            <div key={rule.id} className="flex flex-col md:flex-row items-start md:items-center gap-2 bg-slate-50 p-2 rounded-lg">
                              {index > 0 ? (
                                <select value={rule.logic} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, logic: e.target.value } : r))} className="border-slate-300 rounded p-1.5 text-xs font-bold bg-white w-20 text-indigo-700">
                                  <option value="AND">И</option>
                                  <option value="OR">ИЛИ</option>
                                </select>
                              ) : <span className="w-20 text-xs font-bold text-slate-400 text-center hidden md:inline-block">Где</span>}
                              <select value={rule.col} onChange={(e) => setAccrualRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, col: e.target.value } : r))} className="w-full md:flex-1 border-slate-300 rounded p-1.5 text-sm bg-white">
                                <option value="">Колонка...</option>
                                {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
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
                          <div className="flex flex-col sm:flex-row gap-4">
                            <label className="flex items-center gap-2 bg-white p-3 rounded-lg border border-indigo-200 cursor-pointer flex-1">
                              <input type="radio" checked={accrualAction === 'split'} onChange={() => setAccrualAction('split')} />
                              <span className="font-bold text-sm text-indigo-800">РБП (равные доли)</span>
                            </label>
                            <label className="flex items-center gap-2 bg-white p-3 rounded-lg border border-indigo-200 cursor-pointer flex-1">
                              <input type="radio" checked={accrualAction === 'shift'} onChange={() => setAccrualAction('shift')} />
                              <span className="font-bold text-sm text-indigo-800">Сдвинуть дату</span>
                            </label>
                          </div>
                          {accrualAction === 'split' ? (
                            <div className="flex flex-wrap items-center gap-3">
                              <select value={accrualSumCol} onChange={(e) => setAccrualSumCol(e.target.value)} className="w-full sm:w-48 border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                                <option value="">Авто (сумма/sum)</option>
                                {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input type="number" min="1" max="60" value={accrualMonths} onChange={(e) => setAccrualMonths(e.target.value)} className="w-20 border-indigo-200 rounded p-2 text-center font-bold" />
                              <span className="text-sm font-bold text-indigo-800">месяцев</span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-3">
                              <select value={accrualDateCol} onChange={(e) => setAccrualDateCol(e.target.value)} className="w-full sm:w-48 border-indigo-200 rounded p-2 text-sm bg-white font-bold">
                                <option value="">Колонка даты...</option>
                                {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input type="date" value={accrualDateVal} onChange={(e) => setAccrualDateVal(e.target.value)} className="border-indigo-200 rounded p-2 font-bold" />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {activeRule === 7 && (
                      <div className="space-y-6">
                        <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800"><Calculator className="text-indigo-500" /> Бухгалтерские проводки</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 space-y-4">
                            <h4 className="font-bold text-indigo-900 text-sm">1. План счетов (из реестра)</h4>
                            <SourcePicker sources={sources} value={coaMatrixId} onChange={setCoaMatrixId} label="План счетов" />
                            {coaMatrix && (
                              <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">Колонка номеров счетов</label>
                                <select value={coaAccCol} onChange={(e) => setCoaAccCol(e.target.value)} className="w-full border-indigo-300 rounded p-2 text-sm font-bold bg-white text-indigo-800">
                                  <option value="">Выберите...</option>
                                  {coaMatrix.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                          <div className="bg-purple-50 p-6 rounded-xl border border-purple-100 space-y-4">
                            <h4 className="font-bold text-purple-900 text-sm">2. База операций (из реестра)</h4>
                            <SourcePicker sources={sources} value={opsSourceId} onChange={setOpsSourceId} label="Операции" />
                            {opsTable && (
                              <div>
                                <label className="text-xs font-bold text-slate-500 block mb-1">Колонка названий операций</label>
                                <select value={opsCol} onChange={(e) => setOpsCol(e.target.value)} className="w-full border-purple-300 rounded p-2 text-sm font-bold bg-white text-purple-800">
                                  <option value="">Выберите...</option>
                                  {opsTable.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                        {virtRules.length > 0 && (
                          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
                            <h4 className="font-bold text-slate-900 text-sm">3. Матрица проводок</h4>
                            <div className="space-y-3 max-h-[400px] overflow-y-auto">
                              {virtRules.map((rule) => (
                                <div key={rule.id} className="grid grid-cols-[2fr_1fr_1fr] gap-4 items-center">
                                  <div className="text-sm font-bold text-slate-700 truncate">{rule.opName}</div>
                                  <select value={rule.dt} onChange={(e) => setVirtRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, dt: e.target.value } : r))} className="border-slate-300 rounded-md p-2 bg-white text-sm" disabled={!coaAccCol}>
                                    <option value="">Дебет...</option>
                                    {coaAccounts.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                  <select value={rule.ct} onChange={(e) => setVirtRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, ct: e.target.value } : r))} className="border-slate-300 rounded-md p-2 bg-white text-sm" disabled={!coaAccCol}>
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
                        <SourcePicker sources={sources} value={primarySourceId} onChange={setPrimarySourceId} label="Таблица" />
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                          <div>
                            <label className="font-bold text-sm text-slate-700 mb-1 block">Колонка суммы</label>
                            <select value={revalSumCol} onChange={(e) => setRevalSumCol(e.target.value)} className="w-full border-slate-300 rounded p-2">
                              <option value="">Выберите...</option>
                              {primaryColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="font-bold text-sm text-slate-700 mb-1 block">Коэффициент</label>
                            <input type="number" step="0.01" value={revalRate} onChange={(e) => setRevalRate(e.target.value)} className="w-full border-slate-300 rounded p-2 font-bold text-indigo-600 bg-indigo-50" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {activeRule && (
                    <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
                      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
                        <div className="flex-1">
                          <label className="text-xs font-bold text-slate-500 mb-1 block">
                            Имя правила / шаблона трансформации
                          </label>
                          <input
                            type="text"
                            value={ruleNameDraft}
                            onChange={(e) => setRuleNameDraft(e.target.value)}
                            placeholder={`${RULES.find((r) => r.id === activeRule)?.name || 'Правило'}…`}
                            className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-medium"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={saveCurrentAsRule}
                          className="bg-white border-2 border-indigo-200 text-indigo-700 px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-50 transition inline-flex items-center justify-center gap-2"
                        >
                          <Save className="w-4 h-4" />
                          {editingRuleId ? 'Обновить правило' : 'Сохранить как правило'}
                        </button>
                      </div>
                      <div className="flex justify-end">
                        <button type="button" onClick={executeMapping} className="bg-indigo-600 text-white px-8 py-3.5 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-200 flex items-center gap-2 text-lg w-full md:w-auto justify-center">
                          Применить правило <ArrowRight className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ========== STEP 4: Reports ========== */}
          {step === 4 && (
            <ReportsPanel sources={sources} onRegisterResult={registerReportResult} />
          )}

          {/* ========== STEP 3 result panel ========== */}
          {step === 3 && showResult && (
            <div className="space-y-6 py-6">
              {resultData.length > 0 ? (
                <>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                      <Check className="w-10 h-10 text-green-600" />
                    </div>
                    <h2 className="text-3xl font-black text-slate-800 mb-2">Трансформация завершена</h2>
                    <p className="text-slate-500 font-medium mb-8">
                      Строк: <span className="font-bold text-slate-800">{resultData.length}</span>
                      {chainEnabled && primary ? <> · в реестре как основная «{primary.name}»</> : null}
                    </p>
                    {enrichConflicts.length > 0 && (
                      <div className="max-w-3xl mx-auto text-left bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-8">
                        <h3 className="font-black text-amber-900 text-sm mb-1 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" /> Неоднозначные соответствия ({enrichConflicts.length})
                        </h3>
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {enrichConflicts.map((c) => (
                            <div key={c.id} className="bg-white border border-amber-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                              <div className="flex-1 text-sm text-slate-700">
                                <span className="font-bold">[{c.label}]</span> → «{c.col}»
                              </div>
                              <select value={enrichResolutions[c.id] ?? c.values[0]} onChange={(e) => resolveEnrichConflict(c.id, e.target.value)} className="border border-slate-300 rounded p-2 text-sm bg-white font-bold text-indigo-700 sm:w-64">
                                {c.values.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                      <button type="button" onClick={() => { try { exportToExcel(resultData); } catch (err) { setErrorMsg(err.message); } }} className="bg-green-600 text-white px-10 py-4 rounded-xl font-black text-lg hover:bg-green-700 transition shadow-lg shadow-green-200 inline-flex items-center gap-3 w-full sm:w-auto justify-center">
                        <Save className="w-6 h-6" /> Скачать Excel
                      </button>
                      <button type="button" onClick={handleCreateGoogleSheet} disabled={gsheetBusy} className="bg-blue-600 text-white px-10 py-4 rounded-xl font-black text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-200 inline-flex items-center gap-3 w-full sm:w-auto justify-center disabled:opacity-60">
                        <Table className="w-6 h-6" /> {gsheetBusy ? 'Формируем...' : 'Google Таблица'}
                      </button>
                    </div>
                    <div className="mt-4 flex flex-col items-center gap-2">
                      {gsheetUrl && (
                        <a href={gsheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-700 font-bold hover:underline">
                          <ExternalLink className="w-4 h-4" /> Открыть Google Таблицу
                        </a>
                      )}
                      <button type="button" onClick={() => setShowGsheetConfig((v) => !v)} className="inline-flex items-center gap-1.5 text-sm text-blue-700 font-bold">
                        <Sliders className="w-4 h-4" /> {showGsheetConfig ? 'Скрыть настройки Google' : 'Настройки Google Client ID'}
                      </button>
                      {showGsheetConfig && (
                        <div ref={gsheetConfigRef} className="w-full max-w-xl bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-left space-y-3">
                          <label className="text-xs font-bold text-slate-600 block mb-1">Google OAuth Client ID</label>
                          <input type="text" value={gsheetClientId} onChange={(e) => setGsheetClientId(e.target.value)} placeholder="….apps.googleusercontent.com" className="w-full border border-slate-300 rounded p-2 text-sm font-mono bg-white" />
                          <p className="text-xs text-slate-500">Authorized JavaScript origins: <span className="font-mono">{appOrigin}</span></p>
                        </div>
                      )}
                    </div>
                  </div>
                  <DataPreview data={resultData} columns={resultColumns} maxRows={50} />
                  <div className="text-center flex flex-wrap justify-center gap-4">
                    <button type="button" onClick={() => { setShowResult(false); setActiveRule(null); }} className="text-indigo-600 font-bold hover:underline text-sm">К библиотеке правил</button>
                    <button type="button" onClick={() => { saveCurrentAsRule(); setShowResult(false); }} className="text-indigo-600 font-bold hover:underline text-sm">Сохранить как правило</button>
                    <button type="button" onClick={() => setStep(4)} className="text-slate-600 font-bold hover:underline text-sm">К отчётам</button>
                    <button type="button" onClick={() => setStep(1)} className="text-slate-600 font-bold hover:underline text-sm">К реестру источников</button>
                  </div>
                </>
              ) : (
                <div className="text-slate-500 font-medium text-center py-12">Нет данных. Вернитесь к правилам.</div>
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
                <h3 className="text-lg font-black text-slate-800">Соответствие значений</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  <b>{synKey.k1 || '—'}</b> ↔ <b>{synKey.k2 || '—'}</b>
                </p>
              </div>
              <button type="button" onClick={() => setSynModalKeyId(null)} className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2">×</button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Значение основной ({synKey.k1})</label>
                  <input type="text" value={synSearchA} onChange={(e) => setSynSearchA(e.target.value)} placeholder="Поиск..." className="w-full border-slate-300 rounded p-2 text-sm mb-2" />
                  <div className="border border-slate-300 rounded max-h-40 overflow-y-auto bg-white">
                    {synValuesA.filter((v) => v.toLowerCase().includes(synSearchA.toLowerCase())).map((v) => (
                      <button type="button" key={v} onClick={() => setSynInputA(v)} className={`w-full text-left px-3 py-1.5 text-sm border-b border-slate-50 last:border-0 ${synInputA === v ? 'bg-indigo-100 text-indigo-800 font-bold' : 'hover:bg-slate-50'}`}>{v}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">Значение справочника ({synKey.k2})</label>
                  <input type="text" value={synSearchB} onChange={(e) => setSynSearchB(e.target.value)} placeholder="Поиск..." className="w-full border-slate-300 rounded p-2 text-sm mb-2" />
                  <div className="border border-slate-300 rounded max-h-40 overflow-y-auto bg-white">
                    {synValuesB.filter((v) => v.toLowerCase().includes(synSearchB.toLowerCase())).map((v) => (
                      <button type="button" key={v} onClick={() => setSynInputB(v)} className={`w-full text-left px-3 py-1.5 text-sm border-b border-slate-50 last:border-0 ${synInputB === v ? 'bg-indigo-100 text-indigo-800 font-bold' : 'hover:bg-slate-50'}`}>{v}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={addSynonym} disabled={!synInputA || !synInputB} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-40">+ Добавить соответствие</button>
                <label className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm cursor-pointer inline-flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Файл соответствий
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { loadSynonymFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm mb-2">Словарь ({(synKey.synonyms || []).length})</h4>
                {(synKey.synonyms || []).length === 0 ? (
                  <p className="text-sm text-slate-400 font-medium">Пока пусто</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {(synKey.synonyms || []).map((p, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 bg-white text-sm">
                        <span className="flex-1 truncate"><b>{p.a}</b> → <b className="text-indigo-700">{p.b}</b></span>
                        <button type="button" onClick={() => removeSynonym(idx)} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-5 border-t border-slate-200 flex justify-end sticky bottom-0 bg-white">
              <button type="button" onClick={() => setSynModalKeyId(null)} className="bg-slate-800 text-white px-6 py-2.5 rounded-lg font-bold text-sm">Готово</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
