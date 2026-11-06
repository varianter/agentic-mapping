import { Hono } from 'hono';
import { z } from 'zod';
import { answersOf } from '../domain/fields';
import { mapPath } from '../domain/groups';
import { linkedSheet } from '../domain/links';
import { CHOICES, connect, findBinding, ownMapFor } from '../domain/respondents';
import { groupOf } from '../domain/sheets';
import { requireAdminEnabled } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formValues } from '../framework/formAction';
import { respondentToken, setRespondentToken } from '../framework/respondentCookie';
import { ChoicePage, ConnectPage, UnavailablePage } from './connect.view';

const connectSchema = z.strictObject({ credential: z.string(), choice: z.enum(CHOICES).optional() });
const count = (fields: Record<string, string>) => Object.values(fields).filter((value) => value.trim()).length;

// A private link connects this browser to its interview, then My map in the interview's group edits it
// (`/<slug>`, or `/map` without a group). Only the browser's own map in that group is offered for merging.
// The credential is never stored in the browser; only the separate HttpOnly respondent cookie is.
export const connectRoutes = new Hono<AppEnv>()
  .get('/connect', requireAdminEnabled, (c) => c.render(<ConnectPage />))
  // Links shared before /connect existed; browsers keep the fragment across the redirect.
  .get('/participant', requireAdminEnabled, (c) => c.redirect('/connect', 301))
  .post('/connect', requireAdminEnabled, async (c) => {
    const parsed = connectSchema.safeParse(await formValues(c));
    const store = c.get('store');
    const interview = parsed.success ? await linkedSheet(store, parsed.data.credential) : null;
    if (!parsed.success || !interview) {
      c.status(404);
      return c.render(<UnavailablePage />);
    }
    const binding = await findBinding(store, respondentToken(c), groupOf(interview));
    const own = ownMapFor(binding, interview);
    if (own && !parsed.data.choice) {
      return c.render(<ChoicePage credential={parsed.data.credential} mine={count(answersOf(own.fields))} interview={count(answersOf(interview.fields))} />);
    }
    // Recheck right before writing: the interview may have been deleted or relinked meanwhile.
    const current = await linkedSheet(store, parsed.data.credential);
    if (!current) {
      c.status(404);
      return c.render(<UnavailablePage />);
    }
    setRespondentToken(c, await connect(store, binding, current, parsed.data.choice));
    return c.redirect(mapPath(groupOf(current)), 303);
  });
