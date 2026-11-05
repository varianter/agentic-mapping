import type { Context } from 'hono';

// Progressive enhancement: scripts ask for JSON from the same URL a plain form posts to.
export const wantsJson = (c: Context) => (c.req.header('Accept') ?? '').includes('application/json');
