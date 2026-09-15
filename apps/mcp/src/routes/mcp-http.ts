import { findTool, TOOLS } from "../lib/tools";
import { isContentResult, type ToolContext } from "../lib/types";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "youtube", version: "1.0.0" };

export async function handleMcpRequest(
  request: Request,
  ctx: ToolContext,
): Promise<Response> {
  if (request.method !== "POST")
    return new Response("Method Not Allowed", { status: 405 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }

  if (Array.isArray(body)) {
    const replies = (
      await Promise.all(body.map((message) => handleMessage(ctx, message)))
    ).filter((reply) => reply !== null);
    return replies.length
      ? Response.json(replies)
      : new Response(null, { status: 202 });
  }

  const reply = await handleMessage(ctx, body);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

async function handleMessage(ctx: ToolContext, msg: any): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null;

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion)
          ? params.protocolVersion
          : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: t.readOnly,
            destructiveHint: t.destructive,
          },
        })),
      });
    case "tools/call": {
      const tool = findTool(params?.name);
      if (!tool)
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown tool: ${params?.name}` },
        };
      try {
        const result = await tool.handler(ctx, params?.arguments ?? {});
        return reply({
          content: isContentResult(result)
            ? result.__content
            : [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        return reply({
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : err}`,
            },
          ],
          isError: true,
        });
      }
    }
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  status: number,
): Response {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );
}
