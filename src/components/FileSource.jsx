import { FileSpreadsheet, Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';

export default function FileSource({
  source,
  onFile,
  onLink,
  title = 'Перетащите Excel-файл сюда',
  accent = 'indigo',
  compact = false,
}) {
  const [dragOver, setDragOver] = useState(false);
  const palette = {
    indigo: {
      box: 'border-indigo-200 bg-indigo-50/50 hover:border-indigo-400',
      icon: 'text-indigo-400',
      btn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
      alt: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
    },
    purple: {
      box: 'border-purple-200 bg-purple-50/50 hover:border-purple-400',
      icon: 'text-purple-400',
      btn: 'bg-purple-600 hover:bg-purple-700 text-white',
      alt: 'bg-white border border-purple-300 text-purple-700 hover:bg-purple-100',
    },
  }[accent] || {
    box: 'border-indigo-200 bg-indigo-50/50 hover:border-indigo-400',
    icon: 'text-indigo-400',
    btn: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    alt: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  };

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-2xl text-center transition-all ${palette.box} ${
        compact ? 'p-4' : 'p-8'
      } ${dragOver ? 'ring-2 ring-indigo-400' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      {!compact && <FileSpreadsheet className={`w-12 h-12 ${palette.icon} mx-auto mb-4`} />}
      <p className="text-slate-600 font-medium mb-4">{title}</p>
      <label className={`${compact ? palette.alt : palette.btn} px-6 py-2.5 rounded-lg cursor-pointer transition shadow-sm font-bold inline-block`}>
        Выбрать файл
        <input
          type="file"
          className="hidden"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-slate-500 font-medium">
        <span>или по ссылке:</span>
        <input
          type="text"
          value={source.link}
          onChange={(e) => onLink('link', e.target.value)}
          placeholder="https://docs.google.com/..."
          className="border border-slate-300 rounded px-3 py-1.5 w-64 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
          disabled={source.loading}
        />
        <button
          type="button"
          onClick={() => onLink('load')}
          disabled={source.loading}
          className="bg-slate-200 px-3 py-1.5 rounded hover:bg-slate-300 transition disabled:opacity-50"
        >
          {source.loading ? <span className="animate-pulse text-indigo-600">⌛</span> : <LinkIcon className="w-4 h-4" />}
        </button>
      </div>
      {source.loading && <p className="mt-3 text-sm font-bold text-indigo-600 animate-pulse">Загрузка...</p>}
      {source.error && <p className="mt-3 text-sm font-bold text-red-600">{source.error}</p>}
    </div>
  );
}

export function LoadedBadge({ source, onSheetChange }) {
  if (!source.isLoaded || source.loading) return null;
  return (
    <div className="bg-green-50 border border-green-200 p-4 rounded-xl mt-4 space-y-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-green-800">База загружена успешно</h3>
        <span className="bg-white text-green-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm">
          {source.data.length} строк | {source.columns.length} колонок
        </span>
      </div>
      {source.sheets?.length > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t border-green-200">
          <span className="text-sm font-bold text-green-800 whitespace-nowrap">Выбранный лист:</span>
          <select
            value={source.activeSheet}
            onChange={(e) => onSheetChange(e.target.value)}
            className="border border-green-300 bg-white rounded px-3 py-1.5 text-sm font-bold shadow-sm outline-none cursor-pointer flex-1"
          >
            {source.sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
