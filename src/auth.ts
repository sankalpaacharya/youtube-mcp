import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, requireEnv } from "./env";

const TOKEN_FILE = join(ROOT, ".tokens.json");

export const PORT = Number(process.env.PORT ?? 3456);

const REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/auth/callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

let cached: TokenSet | null = null;

async function loadTokens(): Promise<TokenSet | null> {
  if (cached) return cached;
  if (!existsSync(TOKEN_FILE)) return null;
  cached = (await Bun.file(TOKEN_FILE).json()) as TokenSet;
  return cached;
}

async function saveTokens(tokens: TokenSet) {
  cached = tokens;
  await Bun.write(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function authUrl(): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string): Promise<void> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const data = (await res.json()) as any;
  await saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  });
}

async function refresh(tokens: TokenSet): Promise<TokenSet> {
  if (!tokens.refresh_token)
    throw new Error("No refresh token - re-authenticate via `bun run auth`");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = (await res.json()) as any;
  const next: TokenSet = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  await saveTokens(next);
  return next;
}

/** Returns a valid access token, refreshing if needed. Null if never authenticated. */
export async function getAccessToken(): Promise<string | null> {
  let tokens = await loadTokens();
  if (!tokens) return null;
  if (Date.now() > tokens.expires_at - 60_000) tokens = await refresh(tokens);
  return tokens.access_token;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await loadTokens()) !== null;
}
