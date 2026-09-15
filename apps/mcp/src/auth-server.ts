import { join } from "node:path";
import { Elysia } from "elysia";
import { GoogleOAuth } from "./lib/oauth";
import { FileTokenStore } from "./stores/file";
import { getPort, loadLocalEnv, requireEnv, ROOT } from "./utils/env";

loadLocalEnv();
const port = getPort();

const oauth = new GoogleOAuth(
  () => ({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri:
      process.env.OAUTH_REDIRECT_URI ??
      `http://localhost:${port}/auth/callback`,
    loginHint: `Open http://localhost:${port}/auth/login`,
  }),
  new FileTokenStore(join(ROOT, ".tokens.json")),
);

new Elysia({ name: "youtube-mcp.auth" })
  .onError(({ error, set }) => {
    set.status = 500;
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  })
  .get("/", async () => ({
    status: (await oauth.isAuthenticated()) ? "connected" : "not connected",
    login: `http://localhost:${port}/auth/login`,
  }))
  .get("/auth/login", ({ redirect }) => redirect(oauth.authUrl()))
  .get("/auth/callback", async ({ query, set }) => {
    if (query.error) {
      set.status = 400;
      return `OAuth error: ${query.error}`;
    }
    if (!query.code) {
      set.status = 400;
      return "Missing ?code param";
    }
    await oauth.exchangeCode(query.code);
    return "YouTube account connected. Tokens saved to .tokens.json. You can close this tab and stop this server (Ctrl+C).";
  })
  .listen(port);

console.log(`Auth server running.
Open http://localhost:${port}/auth/login to connect your YouTube account.`);
