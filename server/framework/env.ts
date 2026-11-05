import type { Store } from '../store';

// What every request handler can read from the context, set once in app.tsx.
export type AppEnv = {
  Variables: {
    store: Store;
    // Unset in self-only mode: no sign-in, interviews or private links.
    adminKey: string | undefined;
    // The request carries a valid admin cookie.
    admin: boolean;
    // Cookies need the Secure flag (HTTPS request or HTTPS origin configured).
    secure: boolean;
  };
};
