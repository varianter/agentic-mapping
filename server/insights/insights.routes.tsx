import { Hono, type Context } from 'hono';
import { insightsFileName, insightsMarkdown, loadInsights } from '../domain/insights';
import { requireAdmin } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { resolveGroup } from '../framework/group';
import { InsightsPage } from './insights.view';

// A group's qualitative answers on one page, and the same as one Markdown file for an LLM. Mounted at `/`, so
// each route is guarded; `insights` is a reserved group id, so `/insights` is the sheets without a group.
const load = (c: Context<AppEnv>) => loadInsights(c.get('store'), c.get('group') ?? null);

const page = async (c: Context<AppEnv>) => c.render(<InsightsPage insights={await load(c)} />);

async function download(c: Context<AppEnv>) {
  const insights = await load(c);
  c.header('Content-Type', 'text/markdown; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(insightsFileName(insights))}`);
  return c.body(insightsMarkdown(insights));
}

export const insightsRoutes = new Hono<AppEnv>()
  .get('/insights', requireAdmin, resolveGroup, page)
  .get('/insights.md', requireAdmin, resolveGroup, download)
  .get('/:group/insights', requireAdmin, resolveGroup, page)
  .get('/:group/insights.md', requireAdmin, resolveGroup, download);
