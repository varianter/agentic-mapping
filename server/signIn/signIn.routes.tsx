import { Hono } from 'hono';
import { z } from 'zod';
import { sameDigest } from '../domain/credentials';
import { requireAdminEnabled, signIn, signOut } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction, type FormState } from '../framework/formAction';
import { Layout } from '../shell/Layout';

function SignInPage({ form }: { form: FormState }) {
  return (
    <Layout title="Sign in">
      <main class="notice">
        <h1>Interviewer sign-in</h1>
        <p>Sign in with the admin key to create and manage interviews.</p>
        {form.formError && <p class="form-error" role="alert">{form.formError}</p>}
        <form method="post" action="/sign-in">
          <label class="lbl" for="key">Admin key</label>
          <input type="password" id="key" name="key" autocomplete="current-password" required autofocus />
          <div class="actions"><button type="submit" class="btn" data-variant="primary">Sign in</button></div>
        </form>
        <a href="/">Fill in your own map instead</a>
      </main>
    </Layout>
  );
}

const signInForm = formAction({
  schema: z.object({ key: z.string() }),
  loader: async (c) => (c.get('admin') && c.req.method === 'GET' ? c.redirect('/', 303) : {}),
  onSubmit: async (c, { key }) => {
    if (!sameDigest(key, c.get('adminKey')!)) return { formError: 'That admin key is not right.', status: 401 };
    signIn(c);
    return { redirect: '/' };
  },
  view: SignInPage,
});

// Mounted at the root, so the guard is per route rather than `.use()`, which would cover every path.
export const signInRoutes = new Hono<AppEnv>()
  .on(['GET', 'POST'], '/sign-in', requireAdminEnabled, signInForm)
  .post('/sign-out', requireAdminEnabled, (c) => {
    signOut(c);
    return c.redirect('/', 303);
  });
