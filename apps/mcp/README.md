# YouTube MCP

Manage YouTube videos, playlists, thumbnails, and analytics through MCP. The
local server uses Bun; the remote server runs on Cloudflare Workers.

## Google credentials

In [Google Cloud Console](https://console.cloud.google.com/), enable YouTube Data
API v3 and YouTube Analytics API. Configure the OAuth consent screen, add your
Google account as a test user when the app is in testing, and create a Web
application OAuth client. Save its client ID and client secret.

## Local server

Install Bun and the pnpm version pinned in the root package.json. From the
repository root:

```sh
pnpm install
cp apps/mcp/.env.example apps/mcp/.env
```

Fill in the Google credentials in `apps/mcp/.env`. Add
`http://localhost:3456/auth/callback` to the client's authorized redirect URIs.

```sh
pnpm auth
```

Open `http://localhost:3456/auth/login` and approve access. Tokens are saved to
the ignored `apps/mcp/.tokens.json`. Stop the auth server after connecting.

Register the stdio server in Claude Code (replace the absolute path):

```sh
claude mcp add youtube -- bun run /absolute/path/to/youtube-mcp/apps/mcp/src/mcp.ts
```

Existing clients pointing at the old root `src/mcp.ts` must update their path.
Move existing root `.env` and `.tokens.json` files into `apps/mcp` when migrating
an older checkout. Avoid overwriting files already present there.

## Cloudflare Worker

From `apps/mcp`, create a KV namespace and copy its ID into `wrangler.jsonc`.
Set `vars.GOOGLE_CLIENT_ID` in that file, then configure the secrets and deploy:

```sh
pnpm exec wrangler kv namespace create TOKENS
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put MCP_PATH_TOKEN
pnpm deploy
```

Use a long random value for `MCP_PATH_TOKEN`. Add
`https://<worker-url>/auth/callback` to the OAuth client's authorized redirect
URIs. Open `https://<worker-url>/auth/login?key=<MCP_PATH_TOKEN>` and approve
access. In your MCP client, add `https://<worker-url>/mcp/<MCP_PATH_TOKEN>` as
the remote connector URL with authentication set to None. The URL itself grants
access, so keep it private.

For personal deployment settings, copy `wrangler.jsonc` to the ignored
`wrangler.local.jsonc`. Run Wrangler commands with
`--config wrangler.local.jsonc`, and deploy with `pnpm deploy:local`.

## Tools

- Videos: list, inspect, search, and update titles, descriptions, tags, and thumbnails.
- Playlists: create, inspect, update, delete, and add or remove videos.
- Insights: channel analytics, video statistics, top videos, and thumbnail retrieval.

The frontend is a starter and does not yet connect to this service.
