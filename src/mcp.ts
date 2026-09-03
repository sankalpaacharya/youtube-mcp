import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { yt, ytAnalytics, ytSetThumbnail, YouTubeError } from "./youtube";

const server = new McpServer({ name: "youtube", version: "1.0.0" });

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const status = err instanceof YouTubeError ? ` (HTTP ${err.status})` : "";
  return {
    content: [{ type: "text" as const, text: `Error${status}: ${msg}` }],
    isError: true,
  };
}

/** Wraps a handler so YouTube errors surface as readable tool errors. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return fail(err);
    }
  };
}

async function myChannel() {
  const res = await yt("GET", "channels", {
    query: { part: "snippet,statistics,contentDetails", mine: "true" },
  });
  const ch = res.items?.[0];
  if (!ch) throw new Error("No channel found for the authenticated account.");
  return ch;
}

/** Fetches a video, merges the given fields into its snippet/status, and PUTs it back. */
async function updateVideoFields(
  videoId: string,
  fields: {
    title?: string;
    description?: string;
    tags?: string[];
    privacy?: "public" | "unlisted" | "private";
  },
) {
  const res = await yt("GET", "videos", {
    query: { part: "snippet,status", id: videoId },
  });
  const v = res.items?.[0];
  if (!v) throw new Error(`Video ${videoId} not found.`);

  // videos.update replaces the whole snippet, so merge onto the current one
  // (categoryId is required by the API even when unchanged).
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
  const updated = await yt("PUT", "videos", {
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

// ── Channel ──────────────────────────────────────────────────────────────

server.registerTool(
  "my_channel",
  {
    title: "My channel",
    description:
      "Get the authenticated user's channel: id, title, subscriber/view/video counts, and the uploads playlist id.",
  },
  tool(async () => {
    const ch = await myChannel();
    return {
      id: ch.id,
      title: ch.snippet.title,
      customUrl: ch.snippet.customUrl,
      statistics: ch.statistics,
      uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
    };
  }),
);

// ── Videos ───────────────────────────────────────────────────────────────

server.registerTool(
  "list_my_videos",
  {
    title: "List my videos",
    description:
      "List the authenticated user's uploaded videos (newest first). Returns videoId, title, publishedAt, privacy. Use pageToken to paginate.",
    inputSchema: {
      maxResults: z.number().int().min(1).max(50).default(25),
      pageToken: z.string().optional(),
    },
  },
  tool(async ({ maxResults, pageToken }) => {
    const ch = await myChannel();
    const res = await yt("GET", "playlistItems", {
      query: {
        part: "snippet,status",
        playlistId: ch.contentDetails.relatedPlaylists.uploads,
        maxResults: String(maxResults),
        pageToken,
      },
    });
    return {
      videos: (res.items ?? []).map((it: any) => ({
        videoId: it.snippet.resourceId.videoId,
        title: it.snippet.title,
        publishedAt: it.snippet.publishedAt,
        privacy: it.status?.privacyStatus,
      })),
      nextPageToken: res.nextPageToken,
      totalResults: res.pageInfo?.totalResults,
    };
  }),
);

server.registerTool(
  "get_video",
  {
    title: "Get video details",
    description:
      "Get full details for a video: snippet (title, description, tags, categoryId), statistics, status, duration.",
    inputSchema: { videoId: z.string() },
  },
  tool(async ({ videoId }) => {
    const res = await yt("GET", "videos", {
      query: { part: "snippet,statistics,status,contentDetails", id: videoId },
    });
    const v = res.items?.[0];
    if (!v) throw new Error(`Video ${videoId} not found.`);
    return v;
  }),
);

server.registerTool(
  "update_video",
  {
    title: "Update video",
    description:
      "Update a video's title, description, tags, and/or privacy status. Only the provided fields change; the rest are preserved.",
    inputSchema: {
      videoId: z.string(),
      title: z.string().max(100).optional(),
      description: z.string().max(5000).optional(),
      tags: z.array(z.string()).optional(),
      privacy: z.enum(["public", "unlisted", "private"]).optional(),
    },
  },
  tool(({ videoId, ...fields }) => updateVideoFields(videoId, fields)),
);

server.registerTool(
  "update_title",
  {
    title: "Update video title",
    description: "Change only a video's title (max 100 chars, no < or >).",
    inputSchema: { videoId: z.string(), title: z.string().max(100) },
  },
  tool(({ videoId, title }) => updateVideoFields(videoId, { title })),
);

server.registerTool(
  "update_description",
  {
    title: "Update video description",
    description: "Change only a video's description (max 5000 chars, no < or >).",
    inputSchema: { videoId: z.string(), description: z.string().max(5000) },
  },
  tool(({ videoId, description }) =>
    updateVideoFields(videoId, { description }),
  ),
);

server.registerTool(
  "update_tags",
  {
    title: "Update video tags",
    description: "Replace a video's tags with the given list.",
    inputSchema: { videoId: z.string(), tags: z.array(z.string()) },
  },
  tool(({ videoId, tags }) => updateVideoFields(videoId, { tags })),
);

server.registerTool(
  "update_thumbnail",
  {
    title: "Update video thumbnail",
    description:
      "Set a video's custom thumbnail from a local image file path or an image URL (JPEG/PNG, max 2MB). The channel must be verified (phone) for custom thumbnails.",
    inputSchema: {
      videoId: z.string(),
      imagePath: z
        .string()
        .optional()
        .describe("Absolute path to a local JPEG/PNG file"),
      imageUrl: z.string().url().optional().describe("URL of a JPEG/PNG image"),
    },
  },
  tool(async ({ videoId, imagePath, imageUrl }) => {
    if (!imagePath && !imageUrl)
      throw new Error("Provide imagePath or imageUrl.");
    let bytes: Uint8Array;
    let contentType: string;
    if (imagePath) {
      const file = Bun.file(imagePath);
      if (!(await file.exists())) throw new Error(`File not found: ${imagePath}`);
      bytes = new Uint8Array(await file.arrayBuffer());
      contentType = file.type || "image/jpeg";
    } else {
      const res = await fetch(imageUrl!);
      if (!res.ok) throw new Error(`Could not download image (${res.status})`);
      bytes = new Uint8Array(await res.arrayBuffer());
      contentType = res.headers.get("content-type") ?? "image/jpeg";
    }
    if (!/^image\/(jpeg|png)/.test(contentType))
      throw new Error(`Thumbnail must be JPEG or PNG, got ${contentType}`);
    if (bytes.byteLength > 2 * 1024 * 1024)
      throw new Error(
        `Image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB — YouTube's limit is 2MB.`,
      );
    const res = await ytSetThumbnail(videoId, bytes, contentType);
    return {
      videoId,
      thumbnail: res.items?.[0]?.high?.url ?? res.items?.[0]?.default?.url,
      updated: true,
    };
  }),
);

server.registerTool(
  "search_videos",
  {
    title: "Search videos",
    description:
      "Search YouTube videos. Set mineOnly=true to search only your own uploads.",
    inputSchema: {
      query: z.string(),
      mineOnly: z.boolean().default(false),
      maxResults: z.number().int().min(1).max(50).default(10),
    },
  },
  tool(async ({ query, mineOnly, maxResults }) => {
    const res = await yt("GET", "search", {
      query: {
        part: "snippet",
        q: query,
        type: "video",
        maxResults: String(maxResults),
        forMine: mineOnly ? "true" : undefined,
      },
    });
    return (res.items ?? []).map((it: any) => ({
      videoId: it.id.videoId,
      title: it.snippet.title,
      channelTitle: it.snippet.channelTitle,
      publishedAt: it.snippet.publishedAt,
    }));
  }),
);

// ── Playlists ────────────────────────────────────────────────────────────

server.registerTool(
  "list_playlists",
  {
    title: "List my playlists",
    description: "List the authenticated user's playlists with item counts.",
    inputSchema: {
      maxResults: z.number().int().min(1).max(50).default(50),
      pageToken: z.string().optional(),
    },
  },
  tool(async ({ maxResults, pageToken }) => {
    const res = await yt("GET", "playlists", {
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
  }),
);

server.registerTool(
  "create_playlist",
  {
    title: "Create playlist",
    description: "Create a new playlist.",
    inputSchema: {
      title: z.string(),
      description: z.string().optional(),
      privacy: z.enum(["public", "unlisted", "private"]).default("private"),
    },
  },
  tool(async ({ title, description, privacy }) => {
    const res = await yt("POST", "playlists", {
      query: { part: "snippet,status" },
      body: {
        snippet: { title, description: description ?? "" },
        status: { privacyStatus: privacy },
      },
    });
    return { playlistId: res.id, title: res.snippet.title, privacy };
  }),
);

server.registerTool(
  "update_playlist",
  {
    title: "Update playlist",
    description: "Update a playlist's title, description, and/or privacy.",
    inputSchema: {
      playlistId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      privacy: z.enum(["public", "unlisted", "private"]).optional(),
    },
  },
  tool(async ({ playlistId, title, description, privacy }) => {
    const res = await yt("GET", "playlists", {
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
    const updated = await yt("PUT", "playlists", {
      query: { part: parts.join(",") },
      body,
    });
    return { playlistId, title: updated.snippet.title, updated: true };
  }),
);

server.registerTool(
  "delete_playlist",
  {
    title: "Delete playlist",
    description: "Permanently delete a playlist (videos themselves are not deleted).",
    inputSchema: { playlistId: z.string() },
  },
  tool(async ({ playlistId }) => {
    await yt("DELETE", "playlists", { query: { id: playlistId } });
    return { playlistId, deleted: true };
  }),
);

server.registerTool(
  "list_playlist_items",
  {
    title: "List playlist items",
    description:
      "List videos in a playlist. Returns playlistItemId (needed to remove/reorder), videoId, title, position.",
    inputSchema: {
      playlistId: z.string(),
      maxResults: z.number().int().min(1).max(50).default(50),
      pageToken: z.string().optional(),
    },
  },
  tool(async ({ playlistId, maxResults, pageToken }) => {
    const res = await yt("GET", "playlistItems", {
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
  }),
);

server.registerTool(
  "add_to_playlist",
  {
    title: "Add video to playlist",
    description:
      "Add a video to a playlist, optionally at a specific position (0 = top).",
    inputSchema: {
      playlistId: z.string(),
      videoId: z.string(),
      position: z.number().int().min(0).optional(),
    },
  },
  tool(async ({ playlistId, videoId, position }) => {
    const snippet: any = {
      playlistId,
      resourceId: { kind: "youtube#video", videoId },
    };
    if (position !== undefined) snippet.position = position;
    const res = await yt("POST", "playlistItems", {
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
  }),
);

server.registerTool(
  "remove_from_playlist",
  {
    title: "Remove video from playlist",
    description:
      "Remove an item from a playlist using its playlistItemId (get it from list_playlist_items).",
    inputSchema: { playlistItemId: z.string() },
  },
  tool(async ({ playlistItemId }) => {
    await yt("DELETE", "playlistItems", { query: { id: playlistItemId } });
    return { playlistItemId, removed: true };
  }),
);

// ── Analytics ────────────────────────────────────────────────────────────

server.registerTool(
  "video_stats",
  {
    title: "Video stats",
    description:
      "Public statistics (views, likes, comments) for up to 50 videos at once.",
    inputSchema: { videoIds: z.array(z.string()).min(1).max(50) },
  },
  tool(async ({ videoIds }) => {
    const res = await yt("GET", "videos", {
      query: { part: "snippet,statistics", id: videoIds.join(",") },
    });
    return (res.items ?? []).map((v: any) => ({
      videoId: v.id,
      title: v.snippet.title,
      views: v.statistics.viewCount,
      likes: v.statistics.likeCount,
      comments: v.statistics.commentCount,
    }));
  }),
);

server.registerTool(
  "channel_analytics",
  {
    title: "Channel analytics",
    description:
      "YouTube Analytics for your channel over a date range (YYYY-MM-DD). Metrics: views, watch time, avg view duration, subscribers gained/lost, likes. Set byDay=true for a daily breakdown, or pass a videoId to scope to one video.",
    inputSchema: {
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      byDay: z.boolean().default(false),
      videoId: z.string().optional(),
    },
  },
  tool(async ({ startDate, endDate, byDay, videoId }) => {
    const res = await ytAnalytics({
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
  }),
);

// ── Start ────────────────────────────────────────────────────────────────

await server.connect(new StdioServerTransport());
console.error("YouTube MCP server running on stdio");
