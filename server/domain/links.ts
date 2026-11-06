import { createHmac } from 'node:crypto';
import type { Store } from '../store';
import { hashCredential, isToken } from './credentials';
import { sourceOf, type Sheet } from './sheets';

// Each interview has one stable link, derived from the admin key and its ID, so the interviewer can always show it.
// Only its hash is stored (`link:<hash>` = { sheetId } and `linkHash` on the sheet); deleting the interview
// turns it off, and rotating ADMIN_KEY turns off every link.
export const participantCredential = (adminKey: string, id: string) => createHmac('sha256', adminKey).update(`agentic-mapping-participant-v1:${id}`).digest('hex');

export async function issueLink(store: Store, adminKey: string, sheet: Sheet) {
  if (sourceOf(sheet) !== 'interview') return null;
  const credential = participantCredential(adminKey, sheet.id);
  const linkHash = hashCredential(credential);
  // Older random or expiring links are replaced by the stable one the first time it is shown.
  if (sheet.linkHash !== linkHash || !await store.get(`link:${linkHash}`)) {
    await store.set(`link:${linkHash}`, { sheetId: sheet.id });
    if (sheet.linkHash !== linkHash) await store.set(`sheet:${sheet.id}`, { ...sheet, linkHash });
    if (sheet.linkHash && sheet.linkHash !== linkHash) await store.del(`link:${sheet.linkHash}`);
  }
  return credential;
}

export async function linkedSheet(store: Store, credential: unknown): Promise<Sheet | null> {
  if (!isToken(credential)) return null;
  const hash = hashCredential(credential);
  const link = await store.get(`link:${hash}`);
  const sheet: Sheet | null = link && await store.get(`sheet:${link.sheetId}`);
  return sheet?.linkHash === hash ? sheet : null;
}
