import { FileSpreadsheet, Link as LinkIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Upload panel for Step 1: local Excel/CSV or Google Sheets link.
 * Caller registers parsed sheets into the sources registry.
 */
export default function SourceUploader({
  onFile,
  onLinkLoad,
  loading = false,
  error = '',
  defaultName = '',
  onDefaultNameChange,
}) {
  const [dragOver, setDragOver] = useState(false);
  const [link, setLink] = useState('');

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) onFile?.(file, defaultName);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-bold text-slate-500 mb-1 block">
          Название источника (необязательно)
        </label>
        <input
          type="text"
          value={defaultName}
          onChange={(e) => onDefaultNameChange?.(e.target.value)}
          placeholder="Напр. Проводки_1С, План_счетов, Драйверы_площади..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-medium bg-white outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div
        className={`border-2 border-dashed rounded-2xl text-center transition-all p-8 border-indigo-200 bg-indigo-50/50 hover:border-indigo-400 ${
          dragOver ? 'ring-2 ring-indigo-400' : ''
        }`}
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
        <FileSpreadsheet className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
        <p className="text-slate-600 font-medium mb-4">
          Перетащите Excel (`.xlsx` / `.xls`) или `.csv`, либо выберите файл
        </p>
        <label className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg cursor-pointer transition shadow-sm font-bold inline-block">
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
          <span>или Google Таблица по ссылке:</span>
          <input
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/..."
            className="border border-slate-300 rounded px-3 py-1.5 w-72 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => onLinkLoad?.(link, defaultName)}
            disabled={loading || !link.trim()}
            className="bg-slate-200 px-3 py-1.5 rounded hover:bg-slate-300 transition disabled:opacity-50 inline-flex items-center gap-1 font-bold"
          >
            {loading ? (
              <span className="animate-pulse text-indigo-600">⌛</span>
            ) : (
              <LinkIcon className="w-4 h-4" />
            )}
            Загрузить
          </button>
        </div>
        {loading && (
          <p className="mt-3 text-sm font-bold text-indigo-600 animate-pulse">Загрузка...</p>
        )}
        {error && <p className="mt-3 text-sm font-bold text-red-600">{error}</p>}
      </div>
    </div>
  );
}
