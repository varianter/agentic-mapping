import { Hono, type Context } from 'hono';
import { revisionSchema, sheetSchema } from '../domain/schemas';
import { deleteSheet, displayName, getSheet, listSheets, publicSheet, saveFields, sourceOf, type Sheet, type Source } from '../domain/sheets';
import { requireAdmin } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction, formValues } from '../framework/formAction';
import { wantsJson } from '../framework/respond';
import { EditorPage, EmptyListPage, NoticePage } from './EditorPage';
import type { SidebarKind } from './Sidebar';

// The interviewer's routes for one list of sheets (interviews, or self-submitted maps), mounted at `/<kind>`:
// the list, the editor, Download JSON and delete. Features add their own routes to the router this returns.
export function sheetEditorRoutes({ kind, source, connectUrl }: {
  kind: SidebarKind;
  source: Source;
  connectUrl?: (c: Context<AppEnv>, sheet: Sheet) => Promise<string | null>;
}) {
  const list = (c: Context<AppEnv>) => listSheets(c.get('store'), source);
  const find = async (c: Context<AppEnv>, id: string) => {
    const sheet = await getSheet(c.get('store'), id);
    return sheet && sourceOf(sheet) === source ? sheet : null;
  };
  const notice = async (c: Context<AppEnv>, status: 404 | 409 | 422, title: string, message: string) => {
    if (wantsJson(c)) return c.json({ error: message }, status);
    c.status(status);
    return c.render(<NoticePage kind={kind} sheets={await list(c)} title={title} message={message} />);
  };
  const unavailable = (c: Context<AppEnv>) => (c.req.method === 'POST'
    ? notice(c, 404, 'Sheet unavailable', 'This sheet was deleted on another device. Copy your notes to keep them.')
    : notice(c, 404, 'Sheet unavailable', 'Choose one from your list.'));

  const editor = formAction({
    schema: sheetSchema,
    // Typed parameters, so the view's props are inferred from these two.
    loader: async (c: Context<AppEnv>) => {
      const sheet = await find(c, c.req.param('id') ?? '');
      return sheet ? { kind, sheet } : unavailable(c);
    },
    // Only rendered pages need the sidebar and the connect URL; both load at once.
    page: async (c: Context<AppEnv>, { sheet }: { sheet: Sheet }) => {
      const [url, sheets] = await Promise.all([connectUrl?.(c, sheet), list(c)]);
      return { sheets, connectUrl: url ?? undefined };
    },
    onSubmit: async (c, { revision, fields }, { sheet }) => {
      const saved = await saveFields(c.get('store'), sheet, revision, fields, { replace: true });
      if (!saved.ok) return { formError: 'Another device changed this sheet. Copy your notes, then reload and merge them.', status: 409 };
      return { redirect: `/${kind}/${sheet.id}?saved`, json: { revision: saved.sheet.revision } };
    },
    view: EditorPage,
  });

  return new Hono<AppEnv>()
    .use(requireAdmin)
    // The most recently edited sheet opens first.
    .get('/', async (c) => {
      const sheets = await list(c);
      const latest = sheets.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
      return latest ? c.redirect(`/${kind}/${latest.id}`, 303) : c.render(<EmptyListPage kind={kind} sheets={sheets} />);
    })
    .get('/:file{[0-9a-fA-F-]{36}\\.json}', async (c) => {
      const sheet = await find(c, c.req.param('file').slice(0, -'.json'.length));
      if (!sheet) return unavailable(c);
      const date = typeof sheet.fields.date === 'string' && sheet.fields.date ? ` - ${sheet.fields.date}` : '';
      c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${kind === 'interviews' ? 'Interview' : 'Map'} - ${displayName(sheet)}${date}.json`)}`);
      return c.json([publicSheet(sheet)]);
    })
    .on(['GET', 'POST'], '/:id', editor)
    .post('/:id/delete', async (c) => {
      const parsed = revisionSchema.safeParse(await formValues(c));
      const deleted = parsed.success ? await deleteSheet(c.get('store'), c.req.param('id'), parsed.data.revision) : { ok: false as const, reason: 'conflict' as const };
      if (!deleted.ok) {
        return deleted.reason === 'missing'
          ? notice(c, 404, 'Not deleted', 'This sheet was already deleted.')
          : notice(c, 409, 'Not deleted', 'The sheet changed since you opened it. Reload it before deleting.');
      }
      return c.redirect(`/${kind}`, 303);
    });
}
