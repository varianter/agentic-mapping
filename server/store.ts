import { Redis } from '@upstash/redis';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Store {
  get(key: string): Promise<any | null>;
  set(key: string, value: unknown, expiresAt?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export function upstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    async get(key) {
      return (await redis.get(key)) ?? null;
    },
    async set(key, value, expiresAt) {
      if (expiresAt === undefined) await redis.set(key, value);
      else await redis.set(key, value, { pxat: expiresAt });
    },
    async del(...keys) {
      if (keys.length) await redis.del(...keys);
    },
    async keys(prefix) {
      const found: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await redis.scan(cursor, { match: `${prefix}*`, count: 200 });
        cursor = String(next);
        found.push(...batch);
      } while (cursor !== '0');
      return [...new Set(found)];
    },
  };
}

// In-memory store; persists to a JSON file when `file` is set. `failWrites` makes writes throw (tests).
export function memoryStore(file?: string): Store & { failWrites: boolean } {
  const entries = new Map<string, { value: string; expiresAt?: number }>();
  const path = file ? resolve(file) : undefined;
  if (path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path)) {
      for (const [key, entry] of Object.entries(JSON.parse(readFileSync(path, 'utf8')))) entries.set(key, entry as any);
    }
  }
  const live = (key: string) => {
    const entry = entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };
  const persist = () => {
    if (!path) return;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
    renameSync(temporary, path);
  };
  const store = {
    failWrites: false,
    async get(key: string) {
      const entry = live(key);
      return entry ? JSON.parse(entry.value) : null;
    },
    async set(key: string, value: unknown, expiresAt?: number) {
      if (store.failWrites) throw new Error('Write failed.');
      entries.set(key, { value: JSON.stringify(value), expiresAt });
      persist();
    },
    async del(...keys: string[]) {
      if (store.failWrites) throw new Error('Write failed.');
      for (const key of keys) entries.delete(key);
      persist();
    },
    async keys(prefix: string) {
      return [...entries.keys()].filter((key) => key.startsWith(prefix) && live(key));
    },
  };
  return store;
}

// KV variables select Upstash Redis; otherwise a local JSON file keeps notes across restarts.
export function storeFromEnv(env: Record<string, string | undefined>): Store {
  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) return upstashStore(env.KV_REST_API_URL, env.KV_REST_API_TOKEN);
  return memoryStore(env.LOCAL_STORE_FILE ?? './data/store.json');
}
