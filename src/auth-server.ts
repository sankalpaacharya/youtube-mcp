import { Elysia } from "elysia";
import { PORT, authUrl, exchangeCode, isAuthenticated } from "./auth";

const app = new Elysia()
  .onError(({ error, set }) => {
    set.status = 500;
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  })
  .get("/", async () => {
    const authed = await isAuthenticated();
    return {
      status: authed ? "connected" : "not connected",
      login: `http://localhost:${PORT}/auth/login`,
    };
  })
  .get("/auth/login", ({ redirect }) => redirect(authUrl()))
  .get("/auth/callback", async ({ query, set }) => {
    if (query.error) {
      set.status = 400;
      return `OAuth error: ${query.error}`;
    }
    if (!query.code) {
      set.status = 400;
      return "Missing ?code param";
    }
    await exchangeCode(query.code);
    return "✅ YouTube account connected! Tokens saved to .tokens.json - you can close this tab and stop this server (Ctrl+C).";
  })
  .listen(PORT);

console.log(`Auth server running.
→ Open http://localhost:${PORT}/auth/login to connect your YouTube account.`);
