import { expect, test } from "bun:test";
import { memoryStore } from "../server/store";
import { createApp, sessionToken } from "../server/app";

const adminKey = "vercel-test-admin-key-0123456789-abcd";
const auth = { Cookie: `am_admin=${sessionToken(adminKey)}` };
const sheet = {
  id: crypto.randomUUID(),
  fields: {},
  createdAt: 1,
  updatedAt: 1,
};

test("Vercel entry serves only allowlisted files and requires credentials", async () => {
  const keys = [
    "ADMIN_KEY",
    "VERCEL",
    "VERCEL_ENV",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "VERCEL_URL",
  ];
  const saved = keys.map((k) => process.env[k]);
  try {
    Object.assign(process.env, {
      ADMIN_KEY: adminKey,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      KV_REST_API_URL: "https://kv.invalid",
      KV_REST_API_TOKEN: "test",
      VERCEL_URL: "x-1.vercel.app",
    });
    const { default: app } = await import("../api/index");
    const paths = [
      "/server/app.ts",
      "/server.ts",
      "/package.json",
      "/vercel.json",
      "/.env",
      "/data/sheets.sqlite",
      "/users.json",
    ];
    for (const path of paths) {
      expect(
        (await app.request(`https://x-1.vercel.app${path}`, { headers: auth }))
          .status,
      ).toBe(404);
      expect((await app.request(`https://x-1.vercel.app${path}`)).status).toBe(
        404,
      );
    }
    expect(
      (await app.request("https://x-1.vercel.app/api/sheets")).status,
    ).toBe(401);
    expect(
      (
        await app.request("https://x-1.vercel.app/api/sheets", {
          headers: { Cookie: "am_admin=wrong" },
        })
      ).status,
    ).toBe(401);
    expect(
      (await app.request("https://x-1.vercel.app/participant")).status,
    ).toBe(200);
  } finally {
    keys.forEach((k, i) =>
      saved[i] === undefined
        ? delete process.env[k]
        : (process.env[k] = saved[i]),
    );
  }
});

test("preview origins may write; other origins are rejected", async () => {
  const { app } = createApp({
    store: memoryStore(),
    adminKey,
    publicOrigin: "https://prod.example",
    allowedOrigins: ["https://x-1.vercel.app", "https://x-git-b.vercel.app"],
  });
  const post = (origin: string) =>
    app.request("https://x-1.vercel.app/api/sheets", {
      method: "POST",
      headers: { ...auth, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...sheet, id: crypto.randomUUID() }),
    });
  expect((await post("https://x-1.vercel.app")).status).toBe(201);
  expect((await post("https://x-git-b.vercel.app")).status).toBe(201);
  expect((await post("https://prod.example")).status).toBe(201);
  expect((await post("https://evil.example")).status).toBe(403);
});

test("vercel.json sends every request to the function and bundles every client file", async () => {
  const config = await Bun.file(new URL("../vercel.json", import.meta.url)).json();
  // `routes` without a filesystem handle runs before static files, so the server injects the mode
  // and repo files such as server/app.ts are never served as-is.
  expect(config.rewrites).toBeUndefined();
  expect(config.routes).toEqual([{ src: "/(.*)", dest: "/api" }]);
  const include = new Bun.Glob(config.functions["api/index.ts"].includeFiles);
  for (const file of new Bun.Glob("client/*.js").scanSync(new URL("..", import.meta.url).pathname)) {
    expect(include.match(file) ? file : `missing ${file}`).toBe(file);
  }
});
