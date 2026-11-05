import { storeFromEnv, type Store } from './store';

export type Config = { store: Store; adminKey?: string; publicOrigin?: string; allowedOrigins: string[] };

// Preview deployments run against the shared storage; their own URLs may write.
export function previewOrigins(env: Record<string, string | undefined>) {
  if (env.VERCEL_ENV !== 'preview') return [];
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter((host): host is string => Boolean(host)).map((host) => `https://${host}`);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  if (typeof env.ADMIN_KEY !== 'string' || env.ADMIN_KEY.length < 32) throw new Error('Config error: set ADMIN_KEY to a secret of at least 32 characters.');
  if (env.VERCEL && !(env.KV_REST_API_URL && env.KV_REST_API_TOKEN)) throw new Error('Config error: set KV_REST_API_URL and KV_REST_API_TOKEN for Production and Preview on Vercel.');
  const publicOrigin = env.APP_ORIGIN || undefined;
  return {
    store: storeFromEnv(env),
    adminKey: env.ADMIN_KEY,
    publicOrigin,
    allowedOrigins: [...(publicOrigin ? [publicOrigin] : []), ...previewOrigins(env)],
  };
}
