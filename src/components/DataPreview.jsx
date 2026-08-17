export default function DataPreview({ data, columns, maxRows = 20, emptyText = 'Нет строк для предпросмотра' }) {
  if (!data?.length) {
    return <p className="text-sm text-slate-500 font-medium">{emptyText}</p>;
  }
  const cols = columns?.length ? columns : Object.keys(data[0] || {});
  const rows = data.slice(0, maxRows);
  return (
    <div className="overflow-auto border border-slate-200 rounded-xl max-h-80">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-slate-50 sticky top-0">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 font-bold text-slate-600 whitespace-nowrap border-b border-slate-200">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50">
              {cols.map((c) => (
                <td key={c} className="px-3 py-1.5 text-slate-700 whitespace-nowrap border-b border-slate-100">
                  {row[c] == null || row[c] === '' ? '—' : String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > maxRows && (
        <p className="text-xs text-slate-500 px-3 py-2 bg-slate-50">Показаны первые {maxRows} из {data.length} строк</p>
      )}
    </div>
  );
}
