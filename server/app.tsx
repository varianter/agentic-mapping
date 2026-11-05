import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { jsxRenderer } from 'hono/jsx-renderer';
import { secureHeaders } from 'hono/secure-headers';
import type { Store } from './store';
import type { AppEnv } from './framework/env';
import { assets } from './framework/assets';
import { isAdmin, sessionToken } from './framework/auth';
import { wantsJson } from './framework/respond';
import { ErrorPage } from './shell/ErrorPage';
import { guideRoutes } from './guide/guide.routes';
import { meRoutes } from './me/me.routes';
import { connectRoutes } from './connect/connect.routes';
import { interviewRoutes } from './interviews/interviews.routes';
import { submissionRoutes } from './submissions/submissions.routes';
import { signInRoutes } from './signIn/signIn.routes';

export { sessionToken };

export type AppConfig = { store: Store; adminKey?: string; publicOrigin?: string; allowedOrigins?: string[] };

const localHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

function checkConfig({ store, adminKey, publicOrigin }: AppConfig) {
  if (adminKey !== undefined && (typeof adminKey !== 'string' || adminKey.length < 32)) throw new Error('Set ADMIN_KEY to a secret of at least 32 characters, or leave it unset for self-only mode.');
  if (!store) throw new Error('The app needs a store.');
  if (!publicOrigin) return;
  const url = new URL(publicOrigin);
  if (url.origin !== publicOrigin) throw new Error('APP_ORIGIN must be an origin without a trailing slash.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost(url.hostname))) throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
}

// Middleware order matters: headers wrap everything, the renderer comes before CSRF so refusals render as pages,
// and interviewer-only features are mounted behind their own `requireAdmin`.
export function createApp(config: AppConfig) {
  checkConfig(config);
  const { store, adminKey, publicOrigin, allowedOrigins = [] } = config;
  const origins = new Set([...(publicOrigin ? [publicOrigin] : []), ...allowedOrigins]);
  const httpsOrigins = [...origins].some((origin) => origin.startsWith('https:'));
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const url = new URL(c.req.url);
    if (url.protocol !== 'https:' && !localHost(url.hostname) && !httpsOrigins) {
      c.res = c.text('HTTPS required.', 403);
    } else {
      await next();
    }
    // Pages hold private answers; only hashed assets set their own caching.
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });
  app.use(secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      fontSrc: ['https://varde.variant.dev'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      objectSrc: ["'none'"],
    },
    // Same-origin requests keep a real Origin header (needed by csrf()); nothing goes to other sites.
    referrerPolicy: 'same-origin',
    xFrameOptions: 'DENY',
    strictTransportSecurity: httpsOrigins ? 'max-age=31536000' : false,
  }));
  app.use(async (c, next) => {
    c.set('store', store);
    c.set('adminKey', adminKey);
    c.set('origin', publicOrigin ?? new URL(c.req.url).origin);
    c.set('secure', new URL(c.req.url).protocol === 'https:' || httpsOrigins);
    c.set('admin', isAdmin(c));
    await next();
  });
  app.use(jsxRenderer(({ children }) => <>{children}</>));
  // Uploads may hold every sheet; everything else is one sheet at most.
  app.use((c, next) => bodyLimit({
    maxSize: (c.req.path === '/interviews/import' ? 10 : 1) * 1024 * 1024,
    onError: (c) => (wantsJson(c) ? c.json({ error: 'Too large to save.' }, 413) : c.text('Too large to save.', 413)),
  })(c, next));
  app.use(csrf({ origin: origins.size ? (origin) => origins.has(origin) : undefined }));

  app.route('/assets', assets);
  app.route('/', signInRoutes);
  app.route('/', guideRoutes);
  app.route('/', meRoutes);
  app.route('/', connectRoutes);
  app.route('/interviews', interviewRoutes);
  app.route('/submissions', submissionRoutes);

  app.notFound((c) => {
    if (wantsJson(c)) return c.json({ error: 'Not found.' }, 404);
    c.status(404);
    return c.render(<ErrorPage title="Page not found" message="This page doesn’t exist, or it needs a different link." />);
  });
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 403) {
      c.status(403);
      return wantsJson(c) ? c.json({ error: 'Cross-site requests are not allowed.' }, 403) : c.render(<ErrorPage title="Request refused" message="Send this form from the app itself." />);
    }
    if (error instanceof HTTPException) return error.getResponse();
    // Never log request details: they may hold answers or credentials.
    console.error('Storage request failed.');
    if (wantsJson(c)) return c.json({ error: 'Storage unavailable. Keep your draft and retry.' }, 503);
    c.status(503);
    return c.render(<ErrorPage title="Storage unavailable" message="Nothing was saved. Go back, keep your draft and try again." />);
  });
  return { app };
}
