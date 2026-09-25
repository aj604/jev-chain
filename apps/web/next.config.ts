import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { updateInitialEnv } from "@next/env";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../..");

/**
 * The monorepo keeps one `.env` at the repo root (TYPESAFE_API_KEY lives
 * there), but Next only reads `.env*` from the app directory. Merge the root
 * files in with Next's precedence (.env.$mode.local > .env.local > .env.$mode
 * > .env). Anything already set — real env vars or apps/web/.env* — wins.
 *
 * Not `loadEnvConfig(repoRoot)`: @next/env caches its first call (for
 * apps/web), so a second call is a silent no-op. `updateInitialEnv` makes the
 * merged values survive Next's env reloads in dev.
 */
function loadRootEnv() {
  const mode = process.env.NODE_ENV === "production" ? "production" : "development";
  const files = [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"];
  const added: Record<string, string> = {};
  for (const file of files) {
    const full = path.join(repoRoot, file);
    if (!existsSync(full)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(full, "utf8")))) {
      if (process.env[key] === undefined && added[key] === undefined && value !== undefined) {
        added[key] = value;
      }
    }
  }
  Object.assign(process.env, added);
  updateInitialEnv(added);
}
loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `jevchain` ships TypeScript source (exports → ./src/index.ts).
  transpilePackages: ["jevchain", "jevchain-examples"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // GoatCounter's script, served first-party so blockers keyed on its domain
  // don't drop it. The count endpoint is a route handler (app/who) instead,
  // because it needs the visitor's IP forwarded.
  async rewrites() {
    return [{ source: "/who.js", destination: "https://gc.zgo.at/count.js" }];
  },
};

export default nextConfig;
