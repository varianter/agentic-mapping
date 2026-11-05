import { createApp } from './server/app';
import { loadConfig } from './server/config';

const { app } = createApp(loadConfig(process.env));

export default { hostname: process.env.BIND_ADDRESS ?? '127.0.0.1', port: Number(process.env.PORT ?? 4321), fetch: app.fetch };
