/**
 * Cloudflare Worker: YouTube MCP server over Streamable HTTP.
 *
 * Routes:
 *   GET  /                      - status
 *   GET  /auth/login?key=TOKEN  - start Google OAuth (key = MCP_PATH_TOKEN)
 *   GET  /auth/callback         - OAuth redirect target; stores tokens in KV
 *   POST /mcp/TOKEN             - MCP Streamable HTTP endpoint (stateless)
 */

interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  TOKENS: KVStore;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MCP_PATH_TOKEN: string;
}

const SCOPES =
  "https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/yt-analytics.readonly";
const DATA_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";
const TOKEN_KEY = "google_tokens";

// ── OAuth / tokens ───────────────────────────────────────────────────────

interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

async function getAccessToken(env: Env): Promise<string> {
  const raw = await env.TOKENS.get(TOKEN_KEY);
  if (!raw)
    throw new Error(
      "Not authenticated - open /auth/login?key=<MCP_PATH_TOKEN> in a browser first.",
    );
  let tokens = JSON.parse(raw) as TokenSet;
  if (Date.now() > tokens.expires_at - 60_000) {
    if (!tokens.refresh_token)
      throw new Error("No refresh token - re-authenticate via /auth/login.");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: tokens.refresh_token,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
    const data = (await res.json()) as any;
    tokens = {
      access_token: data.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    await env.TOKENS.put(TOKEN_KEY, JSON.stringify(tokens));
  }
  return tokens.access_token;
}

// ── YouTube API client ───────────────────────────────────────────────────

async function yt(
  env: Env,
  method: string,
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<any> {
  const url = new URL(`${DATA_BASE}/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined) url.searchParams.set(k, v);
  const token = await getAccessToken(env);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined;
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok)
    throw new Error(data?.error?.message ?? `YouTube API error (${res.status})`);
  return data;
}

async function ytAnalytics(
  env: Env,
  query: Record<string, string | undefined>,
): Promise<any> {
  const url = new URL(`${ANALYTICS_BASE}/reports`);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined) url.searchParams.set(k, v);
  const token = await getAccessToken(env);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok)
    throw new Error(data?.error?.message ?? `Analytics API error (${res.status})`);
  return data;
}

async function myChannel(env: Env) {
  const res = await yt(env, "GET", "channels", {
    query: { part: "snippet,statistics,contentDetails", mine: "true" },
  });
  const ch = res.items?.[0];
  if (!ch) throw new Error("No channel found for the authenticated account.");
  return ch;
}

async function updateVideoFields(
  env: Env,
  videoId: string,
  fields: {
    title?: string;
    description?: string;
    tags?: string[];
    privacy?: string;
  },
) {
  const res = await yt(env, "GET", "videos", {
    query: { part: "snippet,status", id: videoId },
  });
  const v = res.items?.[0];
  if (!v) throw new Error(`Video ${videoId} not found.`);
  const snippet = {
    ...v.snippet,
    title: fields.title ?? v.snippet.title,
    description: fields.description ?? v.snippet.description,
    tags: fields.tags ?? v.snippet.tags,
    categoryId: v.snippet.categoryId,
  };
  const parts = ["snippet"];
  const body: any = { id: videoId, snippet };
  if (fields.privacy) {
    parts.push("status");
    body.status = { ...v.status, privacyStatus: fields.privacy };
  }
  const updated = await yt(env, "PUT", "videos", {
    query: { part: parts.join(",") },
    body,
  });
  return {
    videoId,
    title: updated.snippet.title,
    privacy: updated.status?.privacyStatus ?? v.status?.privacyStatus,
    updated: true,
  };
}

// ── Output formatting helpers ────────────────────────────────────────────

const videoUrl = (id: string) => `https://youtube.com/watch?v=${id}`;

function thumbOf(snippet: any): string | undefined {
  const t = snippet?.thumbnails;
  return (t?.maxres ?? t?.high ?? t?.medium ?? t?.default)?.url;
}

/** "PT1H2M3S" → "1:02:03" */
function fmtDuration(iso?: string): string | undefined {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return iso;
  const [, h, min, s] = m;
  const mm = h ? String(min ?? 0).padStart(2, "0") : String(min ?? 0);
  return `${h ? `${h}:` : ""}${mm}:${String(s ?? 0).padStart(2, "0")}`;
}

const num = (v: unknown) => (v === undefined ? undefined : Number(v));

// ── MCP tools ────────────────────────────────────────────────────────────

type Tool = {
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (env: Env, args: any) => Promise<unknown>;
};

/** MCP tool annotations - clients can skip approval prompts for read-only tools. */
const READ_ONLY = new Set([
  "my_channel",
  "list_my_videos",
  "get_video",
  "search_videos",
  "list_playlists",
  "list_playlist_items",
  "video_stats",
  "top_videos",
  "get_thumbnail",
  "channel_analytics",
]);
const DESTRUCTIVE = new Set(["delete_playlist", "remove_from_playlist"]);

const str = { type: "string" };
const obj = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required });

const TOOLS: Record<string, Tool> = {
  my_channel: {
    description:
      "Get the authenticated user's channel: id, title, subscriber/view/video counts, uploads playlist id.",
    inputSchema: obj({}),
    handler: async (env) => {
      const ch = await myChannel(env);
      return {
        channel: ch.snippet.title,
        url: `https://youtube.com/${ch.snippet.customUrl ?? `channel/${ch.id}`}`,
        subscribers: num(ch.statistics.subscriberCount),
        totalViews: num(ch.statistics.viewCount),
        videoCount: num(ch.statistics.videoCount),
        thumbnail: thumbOf(ch.snippet),
        channelId: ch.id,
        uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
      };
    },
  },
  list_my_videos: {
    description:
      "List the authenticated user's uploaded videos (newest first). Use pageToken to paginate.",
    inputSchema: obj({
      maxResults: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      pageToken: str,
    }),
    handler: async (env, { maxResults = 25, pageToken }) => {
      const ch = await myChannel(env);
      const res = await yt(env, "GET", "playlistItems", {
        query: {
          part: "snippet,status",
          playlistId: ch.contentDetails.relatedPlaylists.uploads,
          maxResults: String(maxResults),
          pageToken,
        },
      });
      return {
        videos: (res.items ?? []).map((it: any) => ({
          title: it.snippet.title,
          publishedAt: it.snippet.publishedAt,
          privacy: it.status?.privacyStatus,
          url: videoUrl(it.snippet.resourceId.videoId),
          thumbnail: thumbOf(it.snippet),
          videoId: it.snippet.resourceId.videoId,
        })),
        nextPageToken: res.nextPageToken,
        totalResults: res.pageInfo?.totalResults,
      };
    },
  },
  get_video: {
    description:
      "Get full details for a video: snippet, statistics, status, duration.",
    inputSchema: obj({ videoId: str }, ["videoId"]),
    handler: async (env, { videoId }) => {
      const res = await yt(env, "GET", "videos", {
        query: { part: "snippet,statistics,status,contentDetails", id: videoId },
      });
      const v = res.items?.[0];
      if (!v) throw new Error(`Video ${videoId} not found.`);
      return {
        title: v.snippet.title,
        description: v.snippet.description,
        tags: v.snippet.tags,
        publishedAt: v.snippet.publishedAt,
        duration: fmtDuration(v.contentDetails?.duration),
        privacy: v.status?.privacyStatus,
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        url: videoUrl(v.id),
        thumbnail: thumbOf(v.snippet),
        videoId: v.id,
        categoryId: v.snippet.categoryId,
      };
    },
  },
  update_video: {
    description:
      "Update a video's title, description, tags, and/or privacy. Only provided fields change.",
    inputSchema: obj(
      {
        videoId: str,
        title: str,
        description: str,
        tags: { type: "array", items: str },
        privacy: { type: "string", enum: ["public", "unlisted", "private"] },
      },
      ["videoId"],
    ),
    handler: (env, { videoId, ...fields }) =>
      updateVideoFields(env, videoId, fields),
  },
  update_title: {
    description: "Change only a video's title (max 100 chars, no < or >).",
    inputSchema: obj({ videoId: str, title: str }, ["videoId", "title"]),
    handler: (env, { videoId, title }) =>
      updateVideoFields(env, videoId, { title }),
  },
  update_description: {
    description: "Change only a video's description (max 5000 chars, no < or >).",
    inputSchema: obj({ videoId: str, description: str }, [
      "videoId",
      "description",
    ]),
    handler: (env, { videoId, description }) =>
      updateVideoFields(env, videoId, { description }),
  },
  update_tags: {
    description: "Replace a video's tags with the given list.",
    inputSchema: obj({ videoId: str, tags: { type: "array", items: str } }, [
      "videoId",
      "tags",
    ]),
    handler: (env, { videoId, tags }) =>
      updateVideoFields(env, videoId, { tags }),
  },
  update_thumbnail: {
    description:
      "Set a video's custom thumbnail from an image URL (JPEG/PNG, max 2MB). Channel must be phone-verified.",
    inputSchema: obj({ videoId: str, imageUrl: str }, ["videoId", "imageUrl"]),
    handler: async (env, { videoId, imageUrl }) => {
      const img = await fetch(imageUrl);
      if (!img.ok) throw new Error(`Could not download image (${img.status})`);
      const contentType = img.headers.get("content-type") ?? "image/jpeg";
      if (!/^image\/(jpeg|png)/.test(contentType))
        throw new Error(`Thumbnail must be JPEG or PNG, got ${contentType}`);
      const bytes = await img.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024)
        throw new Error("Image exceeds YouTube's 2MB thumbnail limit.");
      const token = await getAccessToken(env);
      const res = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
          },
          body: bytes,
        },
      );
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok)
        throw new Error(
          data?.error?.message ?? `Thumbnail upload failed (${res.status})`,
        );
      return {
        videoId,
        thumbnail: data.items?.[0]?.high?.url ?? data.items?.[0]?.default?.url,
        updated: true,
      };
    },
  },
  search_videos: {
    description:
      "Search YouTube videos. Set mineOnly=true to search only your own uploads. Costs 100 quota units.",
    inputSchema: obj(
      {
        query: str,
        mineOnly: { type: "boolean", default: false },
        maxResults: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      ["query"],
    ),
    handler: async (env, { query, mineOnly = false, maxResults = 10 }) => {
      const res = await yt(env, "GET", "search", {
        query: {
          part: "snippet",
          q: query,
          type: "video",
          maxResults: String(maxResults),
          forMine: mineOnly ? "true" : undefined,
        },
      });
      return (res.items ?? []).map((it: any) => ({
        title: it.snippet.title,
        channel: it.snippet.channelTitle,
        publishedAt: it.snippet.publishedAt,
        url: videoUrl(it.id.videoId),
        thumbnail: thumbOf(it.snippet),
        videoId: it.id.videoId,
      }));
    },
  },
  list_playlists: {
    description: "List the authenticated user's playlists with item counts.",
    inputSchema: obj({
      maxResults: { type: "integer", minimum: 1, maximum: 50, default: 50 },
      pageToken: str,
    }),
    handler: async (env, { maxResults = 50, pageToken }) => {
      const res = await yt(env, "GET", "playlists", {
        query: {
          part: "snippet,contentDetails,status",
          mine: "true",
          maxResults: String(maxResults),
          pageToken,
        },
      });
      return {
        playlists: (res.items ?? []).map((p: any) => ({
          playlistId: p.id,
          title: p.snippet.title,
          description: p.snippet.description,
          itemCount: p.contentDetails.itemCount,
          privacy: p.status?.privacyStatus,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  },
  create_playlist: {
    description: "Create a new playlist.",
    inputSchema: obj(
      {
        title: str,
        description: str,
        privacy: {
          type: "string",
          enum: ["public", "unlisted", "private"],
          default: "private",
        },
      },
      ["title"],
    ),
    handler: async (env, { title, description, privacy = "private" }) => {
      const res = await yt(env, "POST", "playlists", {
        query: { part: "snippet,status" },
        body: {
          snippet: { title, description: description ?? "" },
          status: { privacyStatus: privacy },
        },
      });
      return { playlistId: res.id, title: res.snippet.title, privacy };
    },
  },
  update_playlist: {
    description: "Update a playlist's title, description, and/or privacy.",
    inputSchema: obj(
      {
        playlistId: str,
        title: str,
        description: str,
        privacy: { type: "string", enum: ["public", "unlisted", "private"] },
      },
      ["playlistId"],
    ),
    handler: async (env, { playlistId, title, description, privacy }) => {
      const res = await yt(env, "GET", "playlists", {
        query: { part: "snippet,status", id: playlistId },
      });
      const p = res.items?.[0];
      if (!p) throw new Error(`Playlist ${playlistId} not found.`);
      const body: any = {
        id: playlistId,
        snippet: {
          title: title ?? p.snippet.title,
          description: description ?? p.snippet.description,
        },
      };
      const parts = ["snippet"];
      if (privacy) {
        parts.push("status");
        body.status = { privacyStatus: privacy };
      }
      const updated = await yt(env, "PUT", "playlists", {
        query: { part: parts.join(",") },
        body,
      });
      return { playlistId, title: updated.snippet.title, updated: true };
    },
  },
  delete_playlist: {
    description:
      "Permanently delete a playlist (the videos themselves are not deleted).",
    inputSchema: obj({ playlistId: str }, ["playlistId"]),
    handler: async (env, { playlistId }) => {
      await yt(env, "DELETE", "playlists", { query: { id: playlistId } });
      return { playlistId, deleted: true };
    },
  },
  list_playlist_items: {
    description:
      "List videos in a playlist. Returns playlistItemId (needed to remove), videoId, title, position.",
    inputSchema: obj(
      {
        playlistId: str,
        maxResults: { type: "integer", minimum: 1, maximum: 50, default: 50 },
        pageToken: str,
      },
      ["playlistId"],
    ),
    handler: async (env, { playlistId, maxResults = 50, pageToken }) => {
      const res = await yt(env, "GET", "playlistItems", {
        query: {
          part: "snippet",
          playlistId,
          maxResults: String(maxResults),
          pageToken,
        },
      });
      return {
        items: (res.items ?? []).map((it: any) => ({
          playlistItemId: it.id,
          videoId: it.snippet.resourceId.videoId,
          title: it.snippet.title,
          position: it.snippet.position,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  },
  add_to_playlist: {
    description:
      "Add a video to a playlist, optionally at a specific position (0 = top).",
    inputSchema: obj(
      { playlistId: str, videoId: str, position: { type: "integer", minimum: 0 } },
      ["playlistId", "videoId"],
    ),
    handler: async (env, { playlistId, videoId, position }) => {
      const snippet: any = {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      };
      if (position !== undefined) snippet.position = position;
      const res = await yt(env, "POST", "playlistItems", {
        query: { part: "snippet" },
        body: { snippet },
      });
      return {
        playlistItemId: res.id,
        videoId,
        playlistId,
        position: res.snippet.position,
        added: true,
      };
    },
  },
  remove_from_playlist: {
    description:
      "Remove an item from a playlist by playlistItemId (from list_playlist_items).",
    inputSchema: obj({ playlistItemId: str }, ["playlistItemId"]),
    handler: async (env, { playlistItemId }) => {
      await yt(env, "DELETE", "playlistItems", { query: { id: playlistItemId } });
      return { playlistItemId, removed: true };
    },
  },
  video_stats: {
    description:
      "Public statistics (views, likes, comments) for up to 50 videos at once.",
    inputSchema: obj(
      { videoIds: { type: "array", items: str, minItems: 1, maxItems: 50 } },
      ["videoIds"],
    ),
    handler: async (env, { videoIds }) => {
      const res = await yt(env, "GET", "videos", {
        query: { part: "snippet,statistics", id: videoIds.join(",") },
      });
      return (res.items ?? []).map((v: any) => ({
        title: v.snippet.title,
        views: num(v.statistics.viewCount),
        likes: num(v.statistics.likeCount),
        comments: num(v.statistics.commentCount),
        url: videoUrl(v.id),
        thumbnail: thumbOf(v.snippet),
        videoId: v.id,
      }));
    },
  },
  top_videos: {
    description:
      "Rank the channel's videos by performance - answers questions like 'what is my highest performing video?'. Scans up to 200 most recent uploads and sorts by the chosen metric: views (default), likes, comments, or engagement (likes+comments per view).",
    inputSchema: obj({
      metric: {
        type: "string",
        enum: ["views", "likes", "comments", "engagement"],
        default: "views",
      },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 5 },
    }),
    handler: async (env, { metric = "views", limit = 5 }) => {
      const ch = await myChannel(env);
      const ids: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 4; page++) {
        const res = await yt(env, "GET", "playlistItems", {
          query: {
            part: "snippet",
            playlistId: ch.contentDetails.relatedPlaylists.uploads,
            maxResults: "50",
            pageToken,
          },
        });
        for (const it of res.items ?? [])
          ids.push(it.snippet.resourceId.videoId);
        pageToken = res.nextPageToken;
        if (!pageToken) break;
      }
      const videos: any[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const res = await yt(env, "GET", "videos", {
          query: {
            part: "snippet,statistics",
            id: ids.slice(i, i + 50).join(","),
            maxResults: "50",
          },
        });
        videos.push(...(res.items ?? []));
      }
      const score = (v: any): number => {
        const s = v.statistics ?? {};
        const views = Number(s.viewCount ?? 0);
        const likes = Number(s.likeCount ?? 0);
        const comments = Number(s.commentCount ?? 0);
        if (metric === "likes") return likes;
        if (metric === "comments") return comments;
        if (metric === "engagement")
          return views ? (likes + comments) / views : 0;
        return views;
      };
      const ranked = videos
        .sort((a, b) => score(b) - score(a))
        .slice(0, limit)
        .map((v, i) => ({
          rank: i + 1,
          title: v.snippet.title,
          views: num(v.statistics?.viewCount),
          likes: num(v.statistics?.likeCount),
          comments: num(v.statistics?.commentCount),
          ...(metric === "engagement"
            ? { engagement: `${(score(v) * 100).toFixed(2)}%` }
            : {}),
          publishedAt: v.snippet.publishedAt,
          url: videoUrl(v.id),
          thumbnail: thumbOf(v.snippet),
          videoId: v.id,
        }));
      return { metric, scanned: videos.length, top: ranked };
    },
  },
  get_thumbnail: {
    description:
      "Fetch a video's thumbnail and return it as an image so it can be shown directly in the conversation.",
    inputSchema: obj({ videoId: str }, ["videoId"]),
    handler: async (env, { videoId }) => {
      const res = await yt(env, "GET", "videos", {
        query: { part: "snippet", id: videoId },
      });
      const v = res.items?.[0];
      if (!v) throw new Error(`Video ${videoId} not found.`);
      const url = thumbOf(v.snippet);
      if (!url) throw new Error("No thumbnail available.");
      const img = await fetch(url);
      if (!img.ok) throw new Error(`Could not fetch thumbnail (${img.status})`);
      const bytes = new Uint8Array(await img.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return {
        __content: [
          { type: "text", text: `Thumbnail of "${v.snippet.title}" (${url})` },
          {
            type: "image",
            data: btoa(binary),
            mimeType: img.headers.get("content-type") ?? "image/jpeg",
          },
        ],
      };
    },
  },
  channel_analytics: {
    description:
      "YouTube Analytics over a date range (YYYY-MM-DD): views, watch time, avg view duration, subs gained/lost, likes. byDay=true for daily rows; videoId to scope to one video.",
    inputSchema: obj(
      {
        startDate: str,
        endDate: str,
        byDay: { type: "boolean", default: false },
        videoId: str,
      },
      ["startDate", "endDate"],
    ),
    handler: async (env, { startDate, endDate, byDay = false, videoId }) => {
      const res = await ytAnalytics(env, {
        ids: "channel==MINE",
        startDate,
        endDate,
        metrics:
          "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes",
        dimensions: byDay ? "day" : undefined,
        filters: videoId ? `video==${videoId}` : undefined,
        sort: byDay ? "day" : undefined,
      });
      const headers = (res.columnHeaders ?? []).map((h: any) => h.name);
      const rows = (res.rows ?? []).map((row: any[]) =>
        Object.fromEntries(headers.map((h: string, i: number) => [h, row[i]])),
      );
      return { startDate, endDate, rows };
    },
  },
};

// ── MCP Streamable HTTP (stateless) ──────────────────────────────────────

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function handleRpc(env: Env, msg: any): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null; // notification - no response

  const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: SUPPORTED_PROTOCOLS.includes(params?.protocolVersion)
          ? params.protocolVersion
          : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "youtube", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: READ_ONLY.has(name),
            destructiveHint: DESTRUCTIVE.has(name),
          },
        })),
      });
    case "tools/call": {
      const t = TOOLS[params?.name as string];
      if (!t) return err(-32602, `Unknown tool: ${params?.name}`);
      try {
        const result: any = await t.handler(env, params?.arguments ?? {});
        // Handlers may return pre-built content blocks (e.g. images).
        return reply({
          content: result?.__content ?? [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        });
      } catch (e) {
        return reply({
          content: [
            { type: "text", text: `Error: ${e instanceof Error ? e.message : e}` },
          ],
          isError: true,
        });
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

// ── HTTP routing ─────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/")
      return Response.json({
        service: "youtube-mcp",
        connected: (await env.TOKENS.get(TOKEN_KEY)) !== null,
      });

    if (pathname === "/auth/login") {
      if (url.searchParams.get("key") !== env.MCP_PATH_TOKEN)
        return new Response("Forbidden", { status: 403 });
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/callback`,
        response_type: "code",
        scope: SCOPES,
        access_type: "offline",
        prompt: "consent",
        state: env.MCP_PATH_TOKEN,
      });
      return Response.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        302,
      );
    }

    if (pathname === "/auth/callback") {
      if (url.searchParams.get("state") !== env.MCP_PATH_TOKEN)
        return new Response("Invalid state", { status: 403 });
      const code = url.searchParams.get("code");
      if (!code)
        return new Response(
          `OAuth error: ${url.searchParams.get("error") ?? "missing code"}`,
          { status: 400 },
        );
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${url.origin}/auth/callback`,
          grant_type: "authorization_code",
        }),
      });
      if (!res.ok)
        return new Response(`Token exchange failed: ${await res.text()}`, {
          status: 500,
        });
      const data = (await res.json()) as any;
      await env.TOKENS.put(
        TOKEN_KEY,
        JSON.stringify({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        }),
      );
      return new Response(
        "✅ YouTube account connected! You can close this tab.",
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }

    if (pathname === `/mcp/${env.MCP_PATH_TOKEN}`) {
      if (request.method !== "POST")
        return new Response("Method Not Allowed", { status: 405 });
      let body: any;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
          { status: 400 },
        );
      }
      if (Array.isArray(body)) {
        const replies = (
          await Promise.all(body.map((m) => handleRpc(env, m)))
        ).filter((r) => r !== null);
        return replies.length
          ? Response.json(replies)
          : new Response(null, { status: 202 });
      }
      const reply = await handleRpc(env, body);
      return reply ? Response.json(reply) : new Response(null, { status: 202 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
