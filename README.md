<p align="center">
  <img src="https://cdn.simpleicons.org/youtube/FF0000" width="72" alt="YouTube logo">
</p>

<h1 align="center">youtube-mcp</h1>

<p align="center">Manage your YouTube channel from Claude</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black" alt="Runtime: Bun"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-8A2BE2" alt="Protocol: MCP"></a>
</p>

An MCP server with 20 tools for your YouTube channel: rename videos, edit descriptions and thumbnails, organize playlists, and get real stats. Run it locally for Claude Code, or deploy to Cloudflare Workers and use it from claude.ai anywhere.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sankalpaacharya/youtube-mcp)

## Tools

|           |                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Videos    | `list_my_videos` `get_video` `search_videos`                                                                                          |
| Editing   | `update_title` `update_description` `update_tags` `update_thumbnail` `update_video`                                                   |
| Playlists | `create_playlist` `add_to_playlist` `remove_from_playlist` `list_playlists` `list_playlist_items` `update_playlist` `delete_playlist` |
| Insights  | `top_videos` `video_stats` `channel_analytics` `get_thumbnail` `my_channel`                                                           |

## Setup

**1. Google credentials** (free, 5 min)

In [Google Cloud Console](https://console.cloud.google.com/): create a project, enable **YouTube Data API v3** and **YouTube Analytics API**, set up the OAuth consent screen (External, add yourself as test user), and create an **OAuth client ID** (Web application). Note the client id and secret.

**2. Deploy** (pick one)

<details>
<summary><b>Cloudflare Workers</b> (use from claude.ai on web and mobile)</summary>

Click the deploy button above. During setup, fill in `GOOGLE_CLIENT_ID` and the two secrets: `GOOGLE_CLIENT_SECRET` and `MCP_PATH_TOKEN` (any long random string, keep it safe).

Or with the CLI:

```sh
bun install
bunx wrangler kv namespace create TOKENS    # paste the id into wrangler.jsonc
bunx wrangler secret put GOOGLE_CLIENT_SECRET
bunx wrangler secret put MCP_PATH_TOKEN     # e.g. from: openssl rand -hex 24
bun run deploy
```

Then:

1. Add `https://<your-worker-url>/auth/callback` as a redirect URI on your Google OAuth client
2. Open `https://<your-worker-url>/auth/login?key=<MCP_PATH_TOKEN>` and approve
3. In claude.ai: Settings, Connectors, Add custom connector (Authentication: None) with `https://<your-worker-url>/mcp/<MCP_PATH_TOKEN>`

</details>

<details>
<summary><b>Local</b> (Claude Code / Claude Desktop)</summary>

Add `http://localhost:3456/auth/callback` as a redirect URI on your Google OAuth client, then:

```sh
bun install
cp .env.example .env      # fill in client id and secret
bun run auth              # open http://localhost:3456/auth/login and approve
claude mcp add youtube -- bun run /absolute/path/to/youtube-mcp/src/mcp.ts
```

</details>

**3. Use it**

Ask Claude: "what is my top video this month", "make a playlist of my calculus videos", "rename my latest upload".

## Notes

- Your MCP URL contains the secret token. Treat it like a password.
- YouTube API is free: 10,000 units/day (reads 1, edits ~50, search 100).
- Thumbnails: JPEG/PNG, max 2MB, phone-verified channel required.

## License

[MIT](LICENSE)
