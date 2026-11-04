import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

const app = new Hono();
app.use('/*', serveStatic({ root: './' }));

export default { port: Number(process.env.PORT ?? 4321), fetch: app.fetch };
