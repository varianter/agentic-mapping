import { createApp } from './server/app';

const { app } = createApp({
  databasePath: process.env.DATABASE_PATH ?? './data/sheets.sqlite',
  users: process.env.INTERVIEWER_USERS_FILE ? await Bun.file(process.env.INTERVIEWER_USERS_FILE).json() : {},
  publicOrigin: process.env.APP_ORIGIN,
});

export default { hostname: process.env.BIND_ADDRESS ?? '127.0.0.1', port: Number(process.env.PORT ?? 4321), fetch: app.fetch };
