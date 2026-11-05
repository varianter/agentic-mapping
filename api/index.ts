import { createApp } from '../server/app';
import { loadConfig } from '../server/config';

// Vercel Function (Bun runtime): the same Hono app, configured from environment variables.
const { app } = createApp(loadConfig(process.env));

export default app;
