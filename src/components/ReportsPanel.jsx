import { useCallback, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import DataPreview from './DataPreview.jsx';
import SourcePicker from './SourcePicker.jsx';
import {
  buildAccountAnalysis,
  buildAccountCard,
  buildCoaLookup,
  buildOsv,
  buildSubcontoAnalysis,
  detectPostingColumns,
  formatSkippedDates,
  listAccountsInPostings,
  listAnalyticsColumns,
  parseAccountList,
} from '../lib/reports1c.js';
import { exportToExcel } from '../lib/excel.js';
import { uniqueSorted } from '../lib/parse.js';

const REPORT_KINDS = [
  { id: 'osv', label: 'ОСВ по всем счетам' },
  { id: 'osv_filter', label: 'ОСВ по выбранным счетам' },
  { id: 'card', label: 'Карточка счёта' },
  { id: 'analysis', label: 'Анализ счёта' },
  { id: 'subconto', label: 'Анализ субконто' },
];

export default function ReportsPanel({ sources = [], onRegisterResult }) {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [postingsId, setPostingsId] = useState(null);
  const [coaId, setCoaId] = useState(null);
  const [kind, setKind] = useState('osv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [analyticsCol, setAnalyticsCol] = useState('');
  const [analyticsValue, setAnalyticsValue] = useState('');
  const [subcontoSide, setSubcontoSide] = useState('both');
  const [groupByAccount, setGroupByAccount] = useState(true);
  const [result, setResult] = useState(null);

  const postings = sources.find((s) => s.id === postingsId) || null;
  const coa = sources.find((s) => s.id === coaId) || null;

  const map = useMemo(
    () => (postings ? detectPostingColumns(postings.columns) : {}),
    [postings]
  );
  const analyticsCols = useMemo(
    () => (postings ? listAnalyticsColumns(postings.columns) : []),
    [postings]
  );
  const accounts = useMemo(
    () => (postings ? listAccountsInPostings(postings.data, postings.columns, map) : []),
    [postings, map]
  );
  const orgCol = map.organization || '';
  const orgValues = useMemo(() => {
    if (!postings || !orgCol) return [];
    return uniqueSorted(postings.data.map((r) => r[orgCol]));
  }, [postings, orgCol]);
  const analyticsValues = useMemo(() => {
    if (!postings || !analyticsCol) return [];
    return uniqueSorted(postings.data.map((r) => r[analyticsCol]));
  }, [postings, analyticsCol]);

  /** Common filters passed into every report builder. */
  const buildFilters = useCallback(() => {
    const analytics = [];
    if (analyticsCol && analyticsValue) {
      analytics.push({ column: analyticsCol, value: analyticsValue });
    }
    return {
      organizationCol: orgCol || '',
      organization: orgFilter || '',
      analytics,
    };
  }, [orgCol, orgFilter, analyticsCol, analyticsValue]);

  const resolvedAccounts = useCallback(() => {
    const fromChips = selectedAccounts || [];
    const fromText = parseAccountList(accountFilter);
    return [...new Set([...fromChips, ...fromText])];
  }, [selectedAccounts, accountFilter]);

  const changeKind = (next) => {
    setKind(next);
    setError('');
    setSuccess('');
    // Do not wipe result here — user may compare; new Form replaces it.
  };

  const run = useCallback(() => {
    setError('');
    setSuccess('');
    try {
      if (!postings) throw new Error('Выберите таблицу проводок из реестра');
      const coaLookup = coa ? buildCoaLookup(coa.data, coa.columns) : null;
      const filters = buildFilters();
      const accountsList = resolvedAccounts();

      let out;
      if (kind === 'osv' || kind === 'osv_filter') {
        if (kind === 'osv_filter' && !accountsList.length) {
          throw new Error('Выберите счета (чекбоксы) или введите список счетов');
        }
        out = buildOsv({
          postings: postings.data,
          columns: postings.columns,
          accountFilters: kind === 'osv_filter' ? accountsList : null,
          accountFilter: '',
          dateFrom,
          dateTo,
          mapping: map,
          coaLookup,
          includeCoaAccounts: kind === 'osv' && !!coaLookup,
          filters,
        });
      } else if (kind === 'card') {
        const account = accountFilter || accountsList[0] || '';
        if (!account) throw new Error('Выберите счёт для карточки');
        out = buildAccountCard({
          postings: postings.data,
          columns: postings.columns,
          account,
          dateFrom,
          dateTo,
          mapping: map,
          filters,
          analyticsCol,
          analyticsValue,
        });
      } else if (kind === 'analysis') {
        const account = accountFilter || accountsList[0] || '';
        if (!account) throw new Error('Выберите счёт для анализа');
        out = buildAccountAnalysis({
          postings: postings.data,
          columns: postings.columns,
          account,
          dateFrom,
          dateTo,
          mapping: map,
          analyticsCol,
          analyticsValue,
          filters,
        });
      } else if (kind === 'subconto') {
        if (!analyticsCol) throw new Error('Выберите колонку аналитики / вид субконто');
        out = buildSubcontoAnalysis({
          postings: postings.data,
          columns: postings.columns,
          analyticsCol,
          side: subcontoSide,
          dateFrom,
          dateTo,
          mapping: map,
          filters,
          groupByAccount,
        });
      } else {
        throw new Error('Неизвестный тип отчёта');
      }

      setResult({ kind, ...out });
      const n = out.data?.length ?? 0;
      const skipped = out.skippedDates?.length || 0;
      const samples = skipped ? formatSkippedDates(out.skippedDates, 5) : '';
      setSuccess(
        `Сформировано строк: ${n}` +
          (skipped
            ? ` · пропущено проводок с нераспознанной датой: ${skipped}${samples ? ` (${samples})` : ''}`
            : '')
      );
    } catch (err) {
      setError(err.message || String(err));
      // Keep previous result on error so a bad filter tweak does not wipe the table.
    }
  }, [
    postings,
    coa,
    buildFilters,
    resolvedAccounts,
    kind,
    dateFrom,
    dateTo,
    map,
    analyticsCol,
    analyticsValue,
    subcontoSide,
    groupByAccount,
    accountFilter,
  ]);

  const toggleAccount = (code) => {
    setSelectedAccounts((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const exportData = () => {
    if (!result) return;
    if (result.kind === 'analysis') {
      const flat = [
        ...result.data,
        {},
        { Показатель: '— Разбивка по корреспонденции —', Значение: '' },
        ...result.breakdown.map((r) => {
          const o = {};
          result.breakdownColumns.forEach((c) => {
            o[c] = r[c];
          });
          return o;
        }),
      ];
      exportToExcel(flat, 'Анализ_счёта.xlsx');
      return;
    }
    const rows = result.totals ? [...result.data, result.totals] : result.data;
    exportToExcel(rows, `Отчёт_${result.kind}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-slate-800">Шаг 4. Стандартные отчёты 1С</h2>
        <p className="text-sm text-slate-500 font-medium mt-1">
          ОСВ, карточка и анализ по журналу проводок из реестра. Входящее сальдо — проводки до
          периода; обороты — внутри периода (включительно); исходящее = входящее + обороты.
          Пересчёт только по кнопке «Сформировать».
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-200 font-bold text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 text-green-700 rounded-xl border border-green-200 font-bold text-sm whitespace-pre-wrap">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SourcePicker
          sources={sources}
          value={postingsId}
          onChange={(id) => {
            setPostingsId(id);
            setResult(null);
            setError('');
            setSuccess('');
          }}
          label="Таблица проводок (из реестра)"
        />
        <SourcePicker
          sources={sources}
          value={coaId}
          onChange={setCoaId}
          label="План счетов (опционально — наименования)"
          excludeIds={[postingsId].filter(Boolean)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Тип отчёта</label>
          <select
            value={kind}
            onChange={(e) => changeKind(e.target.value)}
            className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
          >
            {REPORT_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Период с (dateFrom)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full border-slate-300 rounded-lg p-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">Период по (dateTo)</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full border-slate-300 rounded-lg p-2 text-sm"
          />
        </div>
        {orgCol && (
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Организация</label>
            <select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
            >
              <option value="">Все</option>
              {orgValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {(kind === 'card' || kind === 'analysis') && (
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Счёт</label>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
            >
              <option value="">Выберите…</option>
              {accounts.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'osv_filter' && (
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-slate-500 mb-1 block">
              Счета (мультивыбор) и/или список через запятую
            </label>
            <input
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              placeholder="Напр. 60, 62.01"
              className="w-full border-slate-300 rounded-lg p-2 text-sm font-mono mb-2"
            />
            <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto border border-slate-100 rounded-lg p-2">
              {accounts.map((a) => (
                <label
                  key={a}
                  className={`text-xs font-bold px-2 py-1 rounded-lg border cursor-pointer ${
                    selectedAccounts.includes(a)
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={selectedAccounts.includes(a)}
                    onChange={() => toggleAccount(a)}
                  />
                  {a}
                </label>
              ))}
            </div>
          </div>
        )}
        {(kind === 'analysis' ||
          kind === 'card' ||
          kind === 'subconto' ||
          kind === 'osv' ||
          kind === 'osv_filter') && (
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">
              {kind === 'subconto' ? 'Вид субконто / колонка аналитики' : 'Фильтр аналитики (опц.)'}
            </label>
            <select
              value={analyticsCol}
              onChange={(e) => {
                setAnalyticsCol(e.target.value);
                setAnalyticsValue('');
              }}
              className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
            >
              <option value="">—</option>
              {analyticsCols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {postings?.columns
                ?.filter((c) => !analyticsCols.includes(c) && !Object.values(map).includes(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>
        )}
        {analyticsCol && kind !== 'subconto' && (
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">Значение аналитики</label>
            <select
              value={analyticsValue}
              onChange={(e) => setAnalyticsValue(e.target.value)}
              className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
            >
              <option value="">Все</option>
              {analyticsValues.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {kind === 'subconto' && (
          <>
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">Сторона</label>
              <select
                value={subcontoSide}
                onChange={(e) => setSubcontoSide(e.target.value)}
                className="w-full border-slate-300 rounded-lg p-2 text-sm font-bold bg-white"
              >
                <option value="both">Дт и Кт</option>
                <option value="dt">Только Дт</option>
                <option value="ct">Только Кт</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mt-6">
              <input
                type="checkbox"
                checked={groupByAccount}
                onChange={(e) => setGroupByAccount(e.target.checked)}
              />
              Группировать по счетам
            </label>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={run}
        className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 inline-flex items-center gap-2"
      >
        <Play className="w-4 h-4" /> Сформировать
      </button>

      {result && (
        <div className="space-y-4">
          {result.kind !== kind && (
            <div className="p-2 bg-amber-50 text-amber-800 rounded-lg border border-amber-200 text-xs font-bold">
              Показан предыдущий отчёт ({REPORT_KINDS.find((k) => k.id === result.kind)?.label || result.kind}).
              Нажмите «Сформировать», чтобы пересчитать для текущего типа.
            </div>
          )}
          {result.kind === 'analysis' && (
            <>
              <h3 className="font-bold text-slate-800 text-sm">Сводка по счёту</h3>
              <DataPreview data={result.data} columns={result.columns} maxRows={20} />
              <h3 className="font-bold text-slate-800 text-sm">
                Разбивка оборотов по корреспонденции
              </h3>
              <DataPreview
                data={result.breakdown}
                columns={result.breakdownColumns}
                maxRows={200}
              />
            </>
          )}
          {result.kind !== 'analysis' && (
            <DataPreview
              data={result.totals ? [...result.data, result.totals] : result.data}
              columns={result.columns}
              maxRows={200}
            />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={exportData}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              Excel
            </button>
            {onRegisterResult && (
              <button
                type="button"
                onClick={() => {
                  const rows =
                    result.kind === 'analysis'
                      ? result.breakdown
                      : result.totals
                        ? [...result.data, result.totals]
                        : result.data;
                  onRegisterResult(rows, `Отчёт_${result.kind}`);
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
  );
}
