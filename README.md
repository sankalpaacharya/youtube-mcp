# youtube-mcp

**Manage your YouTube channel by talking to AI.** An [MCP](https://modelcontextprotocol.io) server that gives Claude (or any MCP client) 20 tools to organize your videos and playlists, update titles/descriptions/thumbnails, and answer questions about your channel's performance — with real data, not guesses.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-black)](https://bun.sh)
[![Deploy: Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare_Workers-orange)](https://workers.cloudflare.com)

Ask things like:

> *"What's my highest performing video?"*
> *"Make a 'Trigonometry' playlist and move all my trig videos into it"*
> *"Rename my latest upload and give it a better description"*
> *"Show me the thumbnail of my most-viewed video — now replace it with this image"*

Runs two ways, same tools:

- **Locally** (Bun + stdio) — for Claude Code / Claude Desktop on your machine
- **On Cloudflare Workers** (Streamable HTTP) — as a [custom connector](https://support.claude.com/en/articles/11175166) for claude.ai on web and mobile, usable from anywhere

## Tools

| Category | Tools |
|---|---|
| **Channel** | `my_channel` |
| **Videos** | `list_my_videos` · `get_video` · `search_videos` |
| **Editing** | `update_video` · `update_title` · `update_description` · `update_tags` · `update_thumbnail` |
| **Playlists** | `list_playlists` · `create_playlist` · `update_playlist` · `delete_playlist` · `list_playlist_items` · `add_to_playlist` · `remove_from_playlist` |
| **Insights** | `top_videos` (rank by views/likes/comments/engagement) · `video_stats` · `channel_analytics` (watch time, subs over any date range) · `get_thumbnail` (shows the image in chat) |

Outputs are designed for conversations: titles, watch URLs, thumbnails, and real numbers first; resource IDs last (so the AI can chain actions like *find → rename → add to playlist*). Read-only tools carry MCP `readOnlyHint` annotations so clients can relax permission prompts.

## Setup

### 1. Google Cloud credentials (once, ~5 minutes)

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
2. Enable **YouTube Data API v3** and **YouTube Analytics API** (APIs & Services → Library)
3. Configure the OAuth consent screen: External, add your own Google account as a **test user**
4. Create an **OAuth client ID** (type: *Web application*) and add redirect URIs for the modes you'll use:
   - Local: `http://localhost:3456/auth/callback`
   - Workers: `https://youtube-mcp.<your-subdomain>.workers.dev/auth/callback`

> The app can stay in "Testing" mode forever for personal use — only your test-user account can log in, and no Google verification is needed.

### 2a. Run locally (Claude Code / Claude Desktop)

```sh
bun install
cp .env.example .env        # fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
bun run auth                # then open http://localhost:3456/auth/login and approve
```

Tokens are saved to `.tokens.json` and refresh automatically — the login is one-time. Then register the server:

```sh
claude mcp add youtube -- bun run /absolute/path/to/youtube-mcp/src/mcp.ts
```

### 2b. Deploy to Cloudflare Workers (use from claude.ai anywhere)

```sh
cp wrangler.jsonc.example wrangler.jsonc   # fill in your values
bunx wrangler kv namespace create TOKENS   # paste the id into wrangler.jsonc
bunx wrangler secret put GOOGLE_CLIENT_SECRET
openssl rand -hex 24                       # generate a URL secret, then:
bunx wrangler secret put MCP_PATH_TOKEN    # paste that secret
bun run deploy
```

Connect your YouTube account once by opening:

```
https://youtube-mcp.<your-subdomain>.workers.dev/auth/login?key=<MCP_PATH_TOKEN>
```

Then add it in **claude.ai → Settings → Connectors → Add custom connector** with Authentication: *None*:

```
https://youtube-mcp.<your-subdomain>.workers.dev/mcp/<MCP_PATH_TOKEN>
```

## Security model

The Worker endpoint is protected by the unguessable `MCP_PATH_TOKEN` in the URL path — the same pattern as webhook URLs. Anyone with the full URL can control your channel, so **treat both URLs as secrets**. The OAuth login route is gated by the same token (and a `state` check) so nobody can overwrite your stored account. Tokens live in Cloudflare KV; nothing sensitive is in the repo — `.env`, `.tokens.json`, and `wrangler.jsonc` are all gitignored.

## Good to know

- **Quota**: the YouTube Data API gives 10,000 free units/day. Reads cost 1, edits ~50, `search_videos` costs 100. Organizing playlists all day fits comfortably.
- **Thumbnails**: JPEG/PNG up to 2MB; your channel must be phone-verified for custom thumbnails.
- **Titles/descriptions**: max 100 / 5000 chars; YouTube rejects `<` and `>`.
- Everything is free — no Google billing account required, and the Worker fits in Cloudflare's free tier.

## Architecture

```
src/
├── mcp.ts          # local MCP server (stdio, Bun) — 20 tools via @modelcontextprotocol/sdk
├── worker.ts       # Cloudflare Worker — same 20 tools over MCP Streamable HTTP, tokens in KV
├── auth-server.ts  # local one-time OAuth flow (Elysia)
├── auth.ts         # local token store + refresh
├── youtube.ts      # YouTube Data API v3 + Analytics API v2 client
└── env.ts          # env loading for any working directory
```

## Contributing

Issues and PRs welcome. Run `bun run typecheck` before submitting.

## License

[MIT](LICENSE)
