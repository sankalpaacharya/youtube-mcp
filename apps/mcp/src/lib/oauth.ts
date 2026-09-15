import type { OAuthConfig, TokenSet, TokenStore } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
].join(" ");

export class GoogleOAuth {
  constructor(
    private readonly config: () => OAuthConfig,
    private readonly store: TokenStore,
  ) {}

  authUrl(state?: string): string {
    const { clientId, redirectUri } = this.config();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
    });
    if (state) params.set("state", state);
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string): Promise<void> {
    const { clientId, clientSecret, redirectUri } = this.config();
    const data = await this.requestToken({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    await this.store.save({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
  }

  async getAccessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens)
      throw new Error(`Not authenticated. ${this.config().loginHint}`);
    if (Date.now() <= tokens.expires_at - 60_000) return tokens.access_token;
    return (await this.refresh(tokens)).access_token;
  }

  async isAuthenticated(): Promise<boolean> {
    return (await this.store.load()) !== null;
  }

  private async refresh(tokens: TokenSet): Promise<TokenSet> {
    const { clientId, clientSecret, loginHint } = this.config();
    if (!tokens.refresh_token)
      throw new Error(`Refresh token missing. ${loginHint}`);
    const data = await this.requestToken({
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    });
    const next: TokenSet = {
      access_token: data.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    await this.store.save(next);
    return next;
  }

  private async requestToken(params: Record<string, string>): Promise<any> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    if (!res.ok)
      throw new Error(`Google token request failed: ${await res.text()}`);
    return res.json();
  }
}
