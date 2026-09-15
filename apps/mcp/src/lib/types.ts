import type { YouTubeClient } from "./youtube";

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  loginHint: string;
}

export interface LocalFile {
  bytes: Uint8Array;
  contentType: string;
}

export interface ToolContext {
  yt: YouTubeClient;
  readLocalFile?: (path: string) => Promise<LocalFile>;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ContentResult {
  __content: ContentBlock[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  destructive: boolean;
  handler: (ctx: ToolContext, args: any) => Promise<unknown>;
}

export function isContentResult(value: unknown): value is ContentResult {
  return typeof value === "object" && value !== null && "__content" in value;
}
