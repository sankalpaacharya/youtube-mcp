# youtube-mcp

MCP server for organizing your YouTube channel from Claude — rename videos, build playlists, move videos around, and pull basic analytics. Built with Bun; the one-time OAuth login runs on [Elysia](https://elysiajs.com/).

## Tools

| Tool | What it does |
|---|---|
| `my_channel` | Channel info, subscriber/view counts, uploads playlist id |
| `list_my_videos` | Your uploads (paginated) |
| `get_video` | Full details for one video |
| `update_video` | Change title, description, tags, privacy in one call |
| `update_title` / `update_description` / `update_tags` | Change a single field |
| `update_thumbnail` | Set a custom thumbnail from a local file or URL (JPEG/PNG ≤2MB) |
| `search_videos` | Search YouTube, or just your own uploads |
| `list_playlists` / `create_playlist` / `update_playlist` / `delete_playlist` | Playlist management |
| `list_playlist_items` / `add_to_playlist` / `remove_from_playlist` | Organize videos into playlists |
| `video_stats` | Views/likes/comments for up to 50 videos |
| `channel_analytics` | Views, watch time, subs gained/lost over a date range (daily breakdown or per-video) |

## Setup

### 1. Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create (or pick) a project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API** (APIs & Services → Library).
3. Configure the OAuth consent screen (External, add yourself as a test user).
4. Create credentials → **OAuth client ID** → type **Web application**, and add
   `http://localhost:3456/auth/callback` as an authorized redirect URI.
5. Copy the client id/secret:

```sh
cp .env.example .env   # then fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
```

### 2. Connect your YouTube account (one time)

```sh
bun install
bun run auth
```

Open <http://localhost:3456/auth/login>, approve access, then stop the server (Ctrl+C). Tokens are saved to `.tokens.json` and refresh automatically.

### 3. Register with Claude Code

```sh
claude mcp add youtube -- bun run /home/sanku/work/youtube-mcp/src/mcp.ts
```

Then just ask things like *"rename my latest video to X"*, *"make a 'Tutorials' playlist and put all my videos about bun in it"*, or *"how did the channel do last month, day by day?"*.

## Notes

- Playlist/video **writes need OAuth**; `YOUTUBE_API_KEY` alone only covers public reads.
- The Data API has a 10,000 units/day quota. Most calls cost 1 unit, but `search_videos` costs 100 and writes cost ~50 — playlist organizing fits comfortably, just avoid search-heavy loops.
- Video titles max 100 chars, descriptions 5000; the API rejects `<` and `>` in both.
