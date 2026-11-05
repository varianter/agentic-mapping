// My map on the server: this browser's own answers, or the interview a private link connected it to.
// The browser is recognised by an HttpOnly cookie the server sets on the first save.
async function request(method = 'GET', body) {
  const response = await fetch('/api/me', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
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
export const loadMap = () => request();
export const saveMap = (fields, revision) => request('PUT', { fields, revision });
export const clearMap = () => request('DELETE', {});
