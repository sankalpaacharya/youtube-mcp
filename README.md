<p align="center">
  <img src="https://cdn.simpleicons.org/youtube/FF0000" width="72" alt="YouTube logo">
</p>

<h1 align="center">youtube-mcp</h1>

<p align="center">Manage your YouTube channel from Claude</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black" alt="Runtime: Bun"></a>
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/deploy-Cloudflare%20Workers-F38020" alt="Deploy: Cloudflare Workers"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-8A2BE2" alt="Protocol: MCP"></a>
</p>

youtube-mcp is an MCP server for the YouTube Data API. It lets Claude (or any MCP client) manage your channel: rename videos, edit descriptions, tags and thumbnails, organize playlists, and answer questions about performance with real data instead of guesses.

Runs two ways, same 20 tools:

- **Local** (Bun, stdio) for Claude Code and Claude Desktop
- **Cloudflare Workers** (Streamable HTTP) as a claude.ai custom connector, usable from web and mobile

## Tools

| Category | Tools |
|---|---|
| Channel | `my_channel` |
| Videos | `list_my_videos`, `get_video`, `search_videos` |
| Editing | `update_video`, `update_title`, `update_description`, `update_tags`, `update_thumbnail` |
| Playlists | `list_playlists`, `create_playlist`, `update_playlist`, `delete_playlist`, `list_playlist_items`, `add_to_playlist`, `remove_from_playlist` |
| Insights | `top_videos`, `video_stats`, `channel_analytics`, `get_thumbnail` |

Outputs lead with titles, watch URLs, thumbnails and numbers; resource IDs come last so the client can chain actions (find a video, rename it, add it to a playlist). Read-only tools carry MCP `readOnlyHint` annotations so clients can relax permission prompts.

## Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sankalpaacharya/youtube-mcp)

The button clones this repo into your GitHub, creates the KV namespace in your Cloudflare account, and deploys the Worker. Full walkthrough:

1. **Google credentials** (5 min, free): follow [step 1 below](#1-google-cloud-credentials-once) to get a client id and secret. You will add the redirect URI after deploying, so skip that part for now.
2. **Click the deploy button.** During setup, set the `GOOGLE_CLIENT_ID` variable to your client id, and the two secrets: `GOOGLE_CLIENT_SECRET` (from Google) and `MCP_PATH_TOKEN` (any long random string, e.g. `openssl rand -hex 24`). Keep `MCP_PATH_TOKEN` somewhere safe, it is the key to your server.
3. **Add the redirect URI.** Your Worker now has a URL like `https://youtube-mcp.<your-subdomain>.workers.dev`. In your Google OAuth client, add `<worker-url>/auth/callback` as an authorized redirect URI.
4. **Connect YouTube** (one time): open `<worker-url>/auth/login?key=<MCP_PATH_TOKEN>` and approve. The Worker root page (`<worker-url>/`) shows whether you are connected.
5. **Add to Claude:** in claude.ai go to Settings, Connectors, Add custom connector, choose Authentication: None, and paste `<worker-url>/mcp/<MCP_PATH_TOKEN>`.

Now ask Claude things like "what is my top video this month" or "make a playlist of all my calculus videos".

Prefer the CLI? See [Deploy with wrangler](#2b-deploy-with-wrangler). Want it local-only instead? See [Run locally](#2a-run-locally-claude-code--claude-desktop).

## Setup

### 1. Google Cloud credentials (once)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
2. Enable **YouTube Data API v3** and **YouTube Analytics API** (APIs & Services, Library)
3. Configure the OAuth consent screen: External, and add your own Google account as a test user
4. Create an **OAuth client ID** (type: Web application) and add redirect URIs for the modes you will use:
   - Local: `http://localhost:3456/auth/callback`
   - Workers: `https://youtube-mcp.<your-subdomain>.workers.dev/auth/callback`

The app can stay in "Testing" mode for personal use. Only your test-user account can log in, and no Google verification is needed.

### 2a. Run locally (Claude Code / Claude Desktop)

```sh
bun install
cp .env.example .env        # fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
bun run auth                # then open http://localhost:3456/auth/login and approve
```

Tokens are saved to `.tokens.json` and refresh automatically, so the login is one-time. Then register the server:

```sh
claude mcp add youtube -- bun run /absolute/path/to/youtube-mcp/src/mcp.ts
```

### 2b. Deploy with wrangler

```sh
bun install
bunx wrangler kv namespace create TOKENS   # paste the id into wrangler.jsonc
# set GOOGLE_CLIENT_ID in wrangler.jsonc vars, then:
bunx wrangler secret put GOOGLE_CLIENT_SECRET
openssl rand -hex 24                       # generate a URL secret, then:
bunx wrangler secret put MCP_PATH_TOKEN    # paste that secret
bun run deploy
```

Connect your YouTube account once by opening:

```
https://youtube-mcp.<your-subdomain>.workers.dev/auth/login?key=<MCP_PATH_TOKEN>
```

Then add it in claude.ai under Settings, Connectors, Add custom connector (Authentication: None):

```
https://youtube-mcp.<your-subdomain>.workers.dev/mcp/<MCP_PATH_TOKEN>
```

## Security model

The Worker endpoint is protected by the unguessable `MCP_PATH_TOKEN` in the URL path, the same pattern as webhook URLs. Anyone with the full URL can control your channel, so treat both URLs as secrets. The OAuth login route is gated by the same token (plus a `state` check) so nobody can overwrite your stored account. Tokens live in Cloudflare KV. Nothing sensitive is committed: `.env`, `.tokens.json` and `.dev.vars` are gitignored, and the secrets only exist in Wrangler's secret store. If you fork this repo, avoid committing your own KV namespace id or client id in `wrangler.jsonc` unless you are fine with them being public (they are identifiers, not credentials).

## Notes

- The YouTube Data API gives 10,000 free units/day. Reads cost 1, edits about 50, `search_videos` costs 100.
- Thumbnails: JPEG/PNG up to 2MB, and the channel must be phone-verified for custom thumbnails.
- Titles max 100 chars, descriptions max 5000. YouTube rejects `<` and `>` in both.
- Everything runs free: no Google billing account required, and the Worker fits in Cloudflare's free tier.

## Project layout

```
src/
├── mcp.ts          # local MCP server (stdio, Bun)
├── worker.ts       # Cloudflare Worker, same tools over MCP Streamable HTTP
├── auth-server.ts  # local one-time OAuth flow (Elysia)
├── auth.ts         # local token store + refresh
├── youtube.ts      # YouTube Data API v3 + Analytics API v2 client
└── env.ts          # env loading for any working directory
```

## Contributing

Issues and PRs welcome. Run `bun run typecheck` before submitting.

## License

[MIT](LICENSE)
