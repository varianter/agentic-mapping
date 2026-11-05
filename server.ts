import { createApp } from './server/app';
import { storeFromEnv } from './server/store';

const { app } = createApp({
  store: storeFromEnv(process.env),
  adminKey: process.env.ADMIN_KEY,
  publicOrigin: process.env.APP_ORIGIN,
});

export default { hostname: process.env.BIND_ADDRESS ?? '127.0.0.1', port: Number(process.env.PORT ?? 4321), fetch: app.fetch };
