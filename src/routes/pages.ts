export function statusPage(connected: boolean, origin: string): string {
  const status = connected
    ? '<strong class="ok">YouTube account connected</strong>'
    : '<strong class="no">no YouTube account connected yet</strong>';
  const next = connected
    ? `<p>Ready to use. Add the MCP endpoint as a custom connector in claude.ai:</p>
       <p><code>${origin}/mcp/&lt;MCP_PATH_TOKEN&gt;</code></p>`
    : `<p>Connect your channel by opening:</p>
       <p><code>${origin}/auth/login?key=&lt;MCP_PATH_TOKEN&gt;</code></p>
       <p>(replace with the MCP_PATH_TOKEN secret you set at deploy time)</p>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>youtube-mcp</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:600px;margin:80px auto;padding:0 20px;line-height:1.6;color:#222}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:0.9em}
  .ok{color:#188038}.no{color:#c5221f}
</style>
</head>
<body>
<h1>youtube-mcp</h1>
<p>Status: ${status}</p>
${next}
<p><a href="https://github.com/sankalpaacharya/youtube-mcp">Documentation</a></p>
</body>
</html>`;
}
