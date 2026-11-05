import { storeFromEnv, type Store } from './store';

export type Config = { store?: Store; adminKey?: string; publicOrigin?: string; allowedOrigins: string[] };

// Preview deployments run against the shared storage; their own URLs may write.
export function previewOrigins(env: Record<string, string | undefined>) {
  if (env.VERCEL_ENV !== 'preview') return [];
  return [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter((host): host is string => Boolean(host)).map((host) => `https://${host}`);
}

// Without ADMIN_KEY the app runs in self-only mode and needs no store.
export function loadConfig(env: Record<string, string | undefined>): Config {
  const adminKey = env.ADMIN_KEY || undefined;
  if (adminKey !== undefined && adminKey.length < 32) throw new Error('Config error: set ADMIN_KEY to a secret of at least 32 characters, or leave it unset for self-only mode.');
  if (adminKey && env.VERCEL && !(env.KV_REST_API_URL && env.KV_REST_API_TOKEN)) throw new Error('Config error: set KV_REST_API_URL and KV_REST_API_TOKEN for Production and Preview on Vercel.');
  const publicOrigin = env.APP_ORIGIN || undefined;
  return {
    store: adminKey ? storeFromEnv(env) : undefined,
    adminKey,
    publicOrigin,
    allowedOrigins: [...(publicOrigin ? [publicOrigin] : []), ...previewOrigins(env)],
  };
}
