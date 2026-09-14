import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");

export function loadLocalEnv(): void {
  const envFile = join(ROOT, ".env");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = raw!.replace(/^["']|["']$/g, "");
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Missing ${name}. Set it in ${join(ROOT, ".env")} (see .env.example)`,
    );
  return value;
}

export function getPort(): number {
  return Number(process.env.PORT ?? 3456);
}
