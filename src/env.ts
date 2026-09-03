import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Project root (one level up from src/). */
export const ROOT = join(import.meta.dir, "..");

// The MCP server may be launched from any cwd (e.g. by Claude Code), so Bun's
// automatic .env loading can miss the project's .env — load it explicitly.
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = raw!.replace(/^["']|["']$/g, "");
  }
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val)
    throw new Error(
      `Missing ${name} — set it in ${envFile} (see .env.example)`,
    );
  return val;
}
