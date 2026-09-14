import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleOAuth } from "./lib/oauth";
import { findTool, TOOLS } from "./lib/tools";
import { isContentResult, type ToolContext } from "./lib/types";
import { YouTubeClient } from "./lib/youtube";
import { FileTokenStore } from "./stores/file";
import { getPort, loadLocalEnv, requireEnv, ROOT } from "./utils/env";

loadLocalEnv();

const oauth = new GoogleOAuth(
  () => ({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri:
      process.env.OAUTH_REDIRECT_URI ??
      `http://localhost:${getPort()}/auth/callback`,
    loginHint:
      "Run `bun run auth` in the project and open the login URL it prints.",
  }),
  new FileTokenStore(join(ROOT, ".tokens.json")),
);

const ctx: ToolContext = {
  yt: new YouTubeClient(() => oauth.getAccessToken()),
  readLocalFile: async (path) => {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`File not found: ${path}`);
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || "image/jpeg",
    };
  },
};

const server = new Server(
  { name: "youtube", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const tool = findTool(params.name);
  if (!tool)
    return {
      content: [{ type: "text", text: `Unknown tool: ${params.name}` }],
      isError: true,
    };
  try {
    const result = await tool.handler(ctx, params.arguments ?? {});
    return {
      content: isContentResult(result)
        ? result.__content
        : [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : err}` },
      ],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
console.error("youtube-mcp running on stdio");
