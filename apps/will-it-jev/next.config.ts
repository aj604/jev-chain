import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { updateInitialEnv } from "@next/env";
import type { NextConfig } from "next";

const repoRoot = path.resolve(__dirname, "../..");

/**
 * Same as the studio: merge the repo-root `.env*` files in with Next's
 * precedence (.env.$mode.local > .env.local > .env.$mode > .env). Anything
 * already set — real env vars or apps/will-it-jev/.env* — wins.
 *
 * Not `loadEnvConfig(repoRoot)`: @next/env caches its first call (for this
 * app), so a second call is a silent no-op. `updateInitialEnv` makes the
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
  // `jevchain` and `jevchain-trace-ui` ship TypeScript source (exports → ./src/…).
  transpilePackages: ["jevchain", "jevchain-trace-ui"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
