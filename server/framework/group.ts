import { createMiddleware } from 'hono/factory';
import { getGroup } from '../domain/groups';
import type { AppEnv } from './env';

// Interviewer routers are mounted both at `/<kind>` and `/:group/<kind>`: this sets the group the URL names
// (null without one), or answers 404 for a group that doesn't exist. Nested routers resolve it once.
export const resolveGroup = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('group') === undefined) {
    const slug = c.req.param('group');
    const group = slug === undefined ? null : await getGroup(c.get('store'), slug);
    if (group === null && slug !== undefined) return c.notFound();
    c.set('group', group);
  }
  await next();
});
