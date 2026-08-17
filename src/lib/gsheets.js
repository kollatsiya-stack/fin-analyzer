/**
 * Client-side Google Sheets export.
 *
 * The app has no backend, so a real Google Sheet is created directly from the
 * browser using Google Identity Services (OAuth token flow) plus the Sheets
 * REST API. The caller supplies a Google OAuth Client ID whose authorized
 * JavaScript origin matches where the app is served (e.g. http://localhost:5173).
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SHEETS_ENDPOINT = 'https://sheets.googleapis.com/v4/spreadsheets';
// Per-file Drive scope: lets the app create the spreadsheets it makes without
// requesting broad access to the user's existing files.
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Convert transformed rows into a 2D array (header row + data rows). */
export function resultToValues(data, columns) {
  const cols = columns?.length ? columns : data?.[0] ? Object.keys(data[0]) : [];
  const rows = (data || []).map((row) =>
    cols.map((c) => {
      const v = row[c];
      return v === null || v === undefined ? '' : v;
    })
  );
  return [[...cols], ...rows];
}

function toCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { userEnteredValue: { numberValue: value } };
  }
  if (typeof value === 'boolean') {
    return { userEnteredValue: { boolValue: value } };
  }
  const s = value === null || value === undefined ? '' : String(value);
  return { userEnteredValue: { stringValue: s } };
}

/** Build the Sheets API `spreadsheets.create` request body from a values grid. */
export function buildSpreadsheetBody(title, values, sheetTitle = 'Результат_ETL') {
  return {
    properties: { title },
    sheets: [
      {
        properties: { title: sheetTitle, gridProperties: { frozenRowCount: 1 } },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: values.map((row) => ({ values: row.map(toCell) })),
          },
        ],
      },
    ],
  };
}

/** Load the Google Identity Services script once. */
export function loadGis() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Недоступно вне браузера'));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('gis-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить Google Identity Services')));
      if (window.google?.accounts?.oauth2) resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'gis-script';
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не удалось загрузить Google Identity Services'));
    document.head.appendChild(script);
  });
}

/** Request an OAuth access token via the GIS token client (opens consent popup). */
export function requestAccessToken(clientId, scope = DRIVE_FILE_SCOPE) {
  return new Promise((resolve, reject) => {
    if (!clientId) {
      reject(new Error('Не указан Google OAuth Client ID'));
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services не загружены'));
      return;
    }
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope,
        callback: (resp) => {
          if (resp && resp.access_token) resolve(resp.access_token);
          else reject(new Error(resp?.error_description || resp?.error || 'Не удалось получить доступ Google'));
        },
        error_callback: (err) => reject(new Error(err?.message || 'Авторизация Google отменена')),
      });
      client.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

/** Create a new spreadsheet populated with `values`; returns its id and URL. */
export async function createSpreadsheet(accessToken, title, values) {
  const res = await fetch(SHEETS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildSpreadsheetBody(title, values)),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      message = err?.error?.message || message;
    } catch {
      // response body was not JSON
    }
    throw new Error('Ошибка создания Google Таблицы: ' + message);
  }
  const json = await res.json();
  return { spreadsheetId: json.spreadsheetId, spreadsheetUrl: json.spreadsheetUrl };
}

/** End-to-end helper: ensure GIS is loaded, get a token, and create the sheet. */
export async function exportToGoogleSheet({ clientId, title, data, columns }) {
  await loadGis();
  const token = await requestAccessToken(clientId);
  const values = resultToValues(data, columns);
  return createSpreadsheet(token, title, values);
}
