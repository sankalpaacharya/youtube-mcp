import { GoogleOAuth } from "./lib/oauth";
import type { ToolContext } from "./lib/types";
import { YouTubeClient } from "./lib/youtube";
import { handleMcpRequest } from "./routes/mcp-http";
import { statusPage } from "./routes/pages";
import { KVTokenStore, type KVNamespaceLite } from "./stores/kv";

interface Env {
  TOKENS: KVNamespaceLite;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MCP_PATH_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = new KVTokenStore(env.TOKENS);
    const oauth = new GoogleOAuth(
      () => ({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: `${url.origin}/auth/callback`,
        loginHint: "Open /auth/login?key=<MCP_PATH_TOKEN> in a browser first.",
      }),
      store,
    );

    switch (true) {
      case url.pathname === "/":
        return new Response(
          statusPage(await oauth.isAuthenticated(), url.origin),
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );

      case url.pathname === "/auth/login": {
        if (url.searchParams.get("key") !== env.MCP_PATH_TOKEN)
          return new Response("Forbidden", { status: 403 });
        return Response.redirect(oauth.authUrl(env.MCP_PATH_TOKEN), 302);
      }

      case url.pathname === "/auth/callback": {
        if (url.searchParams.get("state") !== env.MCP_PATH_TOKEN)
          return new Response("Invalid state", { status: 403 });
        const code = url.searchParams.get("code");
        if (!code)
          return new Response(
            `OAuth error: ${url.searchParams.get("error") ?? "missing code"}`,
            { status: 400 },
          );
        await oauth.exchangeCode(code);
        return new Response(
          "YouTube account connected. You can close this tab.",
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        );
      }

      case url.pathname === `/mcp/${env.MCP_PATH_TOKEN}`: {
        const ctx: ToolContext = {
          yt: new YouTubeClient(() => oauth.getAccessToken()),
        };
        return handleMcpRequest(request, ctx);
      }

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};
