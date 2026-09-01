import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * Load the repository-root .env for local development.
 *
 * Next only reads .env files inside its own directory, but this repo keeps one
 * .env at the root serving every project, Python included. Without this the
 * website would need a duplicate copy of the same API key.
 *
 * Real environment variables always win, so this changes nothing on Vercel —
 * there the values come from project settings and the root .env doesn't exist.
 */
function loadRootEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const contents = readFileSync(join(process.cwd(), "..", file), "utf8");
      for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

        const separator = trimmed.indexOf("=");
        const key = trimmed.slice(0, separator).trim().replace(/^export\s+/, "");
        let value = trimmed.slice(separator + 1).trim();
        if (value.length >= 2 && value[0] === value.at(-1) && /["']/.test(value[0])) {
          value = value.slice(1, -1);
        }

        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // no root .env here — normal on Vercel
    }
  }
}

loadRootEnv();

const nextConfig: NextConfig = {};

export default nextConfig;
