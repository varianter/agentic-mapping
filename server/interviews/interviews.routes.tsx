import { Hono } from 'hono';
import { importSheets } from '../domain/import';
import { issueLink } from '../domain/links';
import { blankInterview, createSheet, listSheets } from '../domain/sheets';
import { requireAdmin } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { importMessage, NoticePage } from '../shell/EditorPage';
import { sheetEditorRoutes } from '../shell/sheetEditor';

// Interviews: create, edit, delete, upload, and each interview's connect URL.
export const interviewRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .post('/', async (c) => {
    const { sheet } = await createSheet(c.get('store'), blankInterview());
    return c.redirect(`/interviews/${sheet.id}`, 303);
  })
  // Store dumps and Download JSON files; each sheet goes through the normal create and never overwrites.
  .post('/import', async (c) => {
    const { file } = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    let message: string;
    if (!(file instanceof File)) {
      c.status(422);
      message = 'Choose a store or Download JSON file to upload.';
    } else {
      const result = await importSheets(c.get('store'), await file.text()).catch((error) => {
        if (error instanceof SyntaxError || error?.message === 'The file holds no sheets.') return null;
        throw error;
      });
      if (!result) c.status(422);
      message = !result ? `${file.name} isn’t a store or Download JSON file.` : result.total ? importMessage(result) : `${file.name} holds no sheets.`;
    }
    return c.render(<NoticePage kind="interviews" sheets={await listSheets(c.get('store'), 'interview')} title="Upload" message={message} />);
  })
  .route('/', sheetEditorRoutes({
    kind: 'interviews',
    source: 'interview',
    // Showing the editor issues the interview's stable link the first time.
    connectUrl: async (c, sheet) => `${c.get('origin')}/participant#${await issueLink(c.get('store'), c.get('adminKey')!, sheet)}`,
  }));
