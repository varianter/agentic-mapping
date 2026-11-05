// Server-backed interviews. Access is gated by the HttpOnly admin cookie set at /sign-in.
async function request(path = '', method = 'GET', body) {
  const response = await fetch(`api/sheets${path}`, {
    method,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15000),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    const error = new Error(details?.error ?? `Storage request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? undefined : response.json();
}
export const allSheets = (source) => request(source ? `?source=${source}` : '');
export const getSheet = (id) => request(`/${encodeURIComponent(id)}`);
export const createSheet = (sheet) => request('', 'POST', sheet);
export const putSheet = (sheet) => request(`/${encodeURIComponent(sheet.id)}`, 'PUT', sheet);
export const deleteSheet = (sheet) => request(`/${encodeURIComponent(sheet.id)}`, 'DELETE', { revision: sheet.revision });
export const issueAccess = (id) => request(`/${encodeURIComponent(id)}/access`, 'POST', {});
export const revokeAccess = (id) => request(`/${encodeURIComponent(id)}/access`, 'DELETE', {});
