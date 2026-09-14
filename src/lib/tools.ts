import type { LocalFile, ToolContext, ToolDef } from "./types";
import { fmtDuration, num, thumbOf, toBase64, videoUrl } from "../utils/format";

const str = { type: "string" };
const bool = (def: boolean) => ({ type: "boolean", default: def });
const int = (min: number, max: number, def: number) => ({
  type: "integer",
  minimum: min,
  maximum: max,
  default: def,
});
const strArray = { type: "array", items: str };
const privacyEnum = { type: "string", enum: ["public", "unlisted", "private"] };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

async function myChannel(ctx: ToolContext) {
  const res = await ctx.yt.data("GET", "channels", {
    query: { part: "snippet,statistics,contentDetails", mine: "true" },
  });
  const ch = res.items?.[0];
  if (!ch) throw new Error("No channel found for the authenticated account.");
  return ch;
}

async function getVideo(ctx: ToolContext, videoId: string, part: string) {
  const res = await ctx.yt.data("GET", "videos", {
    query: { part, id: videoId },
  });
  const v = res.items?.[0];
  if (!v) throw new Error(`Video ${videoId} not found.`);
  return v;
}

interface VideoFields {
  title?: string;
  description?: string;
  tags?: string[];
  privacy?: string;
}

async function updateVideoFields(
  ctx: ToolContext,
  videoId: string,
  fields: VideoFields,
) {
  const v = await getVideo(ctx, videoId, "snippet,status");
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
  const updated = await ctx.yt.data("PUT", "videos", {
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

async function loadImage(
  ctx: ToolContext,
  imagePath?: string,
  imageUrl?: string,
): Promise<LocalFile> {
  if (imagePath) {
    if (!ctx.readLocalFile)
      throw new Error(
        "imagePath only works when running locally; use imageUrl.",
      );
    return ctx.readLocalFile(imagePath);
  }
  if (!imageUrl) throw new Error("Provide imagePath or imageUrl.");
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Could not download image (${res.status})`);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "image/jpeg",
  };
}

function summarizeVideo(v: any) {
  return {
    title: v.snippet.title,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    url: videoUrl(v.id),
    thumbnail: thumbOf(v.snippet),
    videoId: v.id,
  };
}

const readOnly = (def: Omit<ToolDef, "readOnly" | "destructive">): ToolDef => ({
  ...def,
  readOnly: true,
  destructive: false,
});

const write = (def: Omit<ToolDef, "readOnly" | "destructive">): ToolDef => ({
  ...def,
  readOnly: false,
  destructive: false,
});

const destructive = (
  def: Omit<ToolDef, "readOnly" | "destructive">,
): ToolDef => ({ ...def, readOnly: false, destructive: true });

export const TOOLS: ToolDef[] = [
  readOnly({
    name: "my_channel",
    description:
      "Get the authenticated user's channel: title, subscriber/view/video counts, uploads playlist id.",
    inputSchema: obj({}),
    handler: async (ctx) => {
      const ch = await myChannel(ctx);
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
  }),
  readOnly({
    name: "list_my_videos",
    description:
      "List the authenticated user's uploaded videos (newest first). Use pageToken to paginate.",
    inputSchema: obj({ maxResults: int(1, 50, 25), pageToken: str }),
    handler: async (ctx, { maxResults = 25, pageToken }) => {
      const ch = await myChannel(ctx);
      const res = await ctx.yt.data("GET", "playlistItems", {
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
  }),
  readOnly({
    name: "get_video",
    description:
      "Get full details for a video: title, description, tags, stats, duration, privacy.",
    inputSchema: obj({ videoId: str }, ["videoId"]),
    handler: async (ctx, { videoId }) => {
      const v = await getVideo(
        ctx,
        videoId,
        "snippet,statistics,status,contentDetails",
      );
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
  }),
  write({
    name: "update_video",
    description:
      "Update a video's title, description, tags, and/or privacy. Only provided fields change.",
    inputSchema: obj(
      {
        videoId: str,
        title: str,
        description: str,
        tags: strArray,
        privacy: privacyEnum,
      },
      ["videoId"],
    ),
    handler: (ctx, { videoId, ...fields }) =>
      updateVideoFields(ctx, videoId, fields),
  }),
  write({
    name: "update_title",
    description: "Change only a video's title (max 100 chars, no < or >).",
    inputSchema: obj({ videoId: str, title: str }, ["videoId", "title"]),
    handler: (ctx, { videoId, title }) =>
      updateVideoFields(ctx, videoId, { title }),
  }),
  write({
    name: "update_description",
    description:
      "Change only a video's description (max 5000 chars, no < or >).",
    inputSchema: obj({ videoId: str, description: str }, [
      "videoId",
      "description",
    ]),
    handler: (ctx, { videoId, description }) =>
      updateVideoFields(ctx, videoId, { description }),
  }),
  write({
    name: "update_tags",
    description: "Replace a video's tags with the given list.",
    inputSchema: obj({ videoId: str, tags: strArray }, ["videoId", "tags"]),
    handler: (ctx, { videoId, tags }) =>
      updateVideoFields(ctx, videoId, { tags }),
  }),
  write({
    name: "update_thumbnail",
    description:
      "Set a video's custom thumbnail from an image URL or local file path (JPEG/PNG, max 2MB). Channel must be phone-verified.",
    inputSchema: obj({ videoId: str, imageUrl: str, imagePath: str }, [
      "videoId",
    ]),
    handler: async (ctx, { videoId, imageUrl, imagePath }) => {
      const image = await loadImage(ctx, imagePath, imageUrl);
      if (!/^image\/(jpeg|png)/.test(image.contentType))
        throw new Error(
          `Thumbnail must be JPEG or PNG, got ${image.contentType}`,
        );
      if (image.bytes.byteLength > 2 * 1024 * 1024)
        throw new Error("Image exceeds YouTube's 2MB thumbnail limit.");
      const res = await ctx.yt.setThumbnail(
        videoId,
        image.bytes,
        image.contentType,
      );
      return {
        videoId,
        thumbnail: res.items?.[0]?.high?.url ?? res.items?.[0]?.default?.url,
        updated: true,
      };
    },
  }),
  readOnly({
    name: "search_videos",
    description:
      "Search YouTube videos. Set mineOnly=true to search only your own uploads. Costs 100 quota units.",
    inputSchema: obj(
      { query: str, mineOnly: bool(false), maxResults: int(1, 50, 10) },
      ["query"],
    ),
    handler: async (ctx, { query, mineOnly = false, maxResults = 10 }) => {
      const res = await ctx.yt.data("GET", "search", {
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
  }),
  readOnly({
    name: "list_playlists",
    description: "List the authenticated user's playlists with item counts.",
    inputSchema: obj({ maxResults: int(1, 50, 50), pageToken: str }),
    handler: async (ctx, { maxResults = 50, pageToken }) => {
      const res = await ctx.yt.data("GET", "playlists", {
        query: {
          part: "snippet,contentDetails,status",
          mine: "true",
          maxResults: String(maxResults),
          pageToken,
        },
      });
      return {
        playlists: (res.items ?? []).map((p: any) => ({
          title: p.snippet.title,
          description: p.snippet.description,
          itemCount: p.contentDetails.itemCount,
          privacy: p.status?.privacyStatus,
          playlistId: p.id,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  }),
  write({
    name: "create_playlist",
    description: "Create a new playlist.",
    inputSchema: obj(
      {
        title: str,
        description: str,
        privacy: { ...privacyEnum, default: "private" },
      },
      ["title"],
    ),
    handler: async (ctx, { title, description, privacy = "private" }) => {
      const res = await ctx.yt.data("POST", "playlists", {
        query: { part: "snippet,status" },
        body: {
          snippet: { title, description: description ?? "" },
          status: { privacyStatus: privacy },
        },
      });
      return { playlistId: res.id, title: res.snippet.title, privacy };
    },
  }),
  write({
    name: "update_playlist",
    description: "Update a playlist's title, description, and/or privacy.",
    inputSchema: obj(
      { playlistId: str, title: str, description: str, privacy: privacyEnum },
      ["playlistId"],
    ),
    handler: async (ctx, { playlistId, title, description, privacy }) => {
      const res = await ctx.yt.data("GET", "playlists", {
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
      const updated = await ctx.yt.data("PUT", "playlists", {
        query: { part: parts.join(",") },
        body,
      });
      return { playlistId, title: updated.snippet.title, updated: true };
    },
  }),
  destructive({
    name: "delete_playlist",
    description:
      "Permanently delete a playlist (the videos themselves are not deleted).",
    inputSchema: obj({ playlistId: str }, ["playlistId"]),
    handler: async (ctx, { playlistId }) => {
      await ctx.yt.data("DELETE", "playlists", { query: { id: playlistId } });
      return { playlistId, deleted: true };
    },
  }),
  readOnly({
    name: "list_playlist_items",
    description:
      "List videos in a playlist. Returns playlistItemId (needed to remove), videoId, title, position.",
    inputSchema: obj(
      { playlistId: str, maxResults: int(1, 50, 50), pageToken: str },
      ["playlistId"],
    ),
    handler: async (ctx, { playlistId, maxResults = 50, pageToken }) => {
      const res = await ctx.yt.data("GET", "playlistItems", {
        query: {
          part: "snippet",
          playlistId,
          maxResults: String(maxResults),
          pageToken,
        },
      });
      return {
        items: (res.items ?? []).map((it: any) => ({
          title: it.snippet.title,
          position: it.snippet.position,
          videoId: it.snippet.resourceId.videoId,
          playlistItemId: it.id,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  }),
  write({
    name: "add_to_playlist",
    description:
      "Add a video to a playlist, optionally at a specific position (0 = top).",
    inputSchema: obj(
      {
        playlistId: str,
        videoId: str,
        position: { type: "integer", minimum: 0 },
      },
      ["playlistId", "videoId"],
    ),
    handler: async (ctx, { playlistId, videoId, position }) => {
      const snippet: any = {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      };
      if (position !== undefined) snippet.position = position;
      const res = await ctx.yt.data("POST", "playlistItems", {
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
  }),
  destructive({
    name: "remove_from_playlist",
    description:
      "Remove an item from a playlist by playlistItemId (from list_playlist_items).",
    inputSchema: obj({ playlistItemId: str }, ["playlistItemId"]),
    handler: async (ctx, { playlistItemId }) => {
      await ctx.yt.data("DELETE", "playlistItems", {
        query: { id: playlistItemId },
      });
      return { playlistItemId, removed: true };
    },
  }),
  readOnly({
    name: "video_stats",
    description:
      "Public statistics (views, likes, comments) for up to 50 videos at once.",
    inputSchema: obj({ videoIds: { ...strArray, minItems: 1, maxItems: 50 } }, [
      "videoIds",
    ]),
    handler: async (ctx, { videoIds }) => {
      const res = await ctx.yt.data("GET", "videos", {
        query: { part: "snippet,statistics", id: videoIds.join(",") },
      });
      return (res.items ?? []).map(summarizeVideo);
    },
  }),
  readOnly({
    name: "top_videos",
    description:
      "Rank the channel's videos by performance. Scans up to 200 recent uploads and sorts by views (default), likes, comments, or engagement.",
    inputSchema: obj({
      metric: {
        type: "string",
        enum: ["views", "likes", "comments", "engagement"],
        default: "views",
      },
      limit: int(1, 50, 5),
    }),
    handler: async (ctx, { metric = "views", limit = 5 }) => {
      const ch = await myChannel(ctx);
      const ids: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 4; page++) {
        const res = await ctx.yt.data("GET", "playlistItems", {
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
        const res = await ctx.yt.data("GET", "videos", {
          query: {
            part: "snippet,statistics",
            id: ids.slice(i, i + 50).join(","),
          },
        });
        videos.push(...(res.items ?? []));
      }
      const score = (v: any) => {
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
      const top = videos
        .sort((a, b) => score(b) - score(a))
        .slice(0, limit)
        .map((v, i) => ({
          rank: i + 1,
          ...summarizeVideo(v),
          ...(metric === "engagement"
            ? { engagement: `${(score(v) * 100).toFixed(2)}%` }
            : {}),
          publishedAt: v.snippet.publishedAt,
        }));
      return { metric, scanned: videos.length, top };
    },
  }),
  readOnly({
    name: "get_thumbnail",
    description:
      "Fetch a video's thumbnail and return it as an image shown directly in the conversation.",
    inputSchema: obj({ videoId: str }, ["videoId"]),
    handler: async (ctx, { videoId }) => {
      const v = await getVideo(ctx, videoId, "snippet");
      const url = thumbOf(v.snippet);
      if (!url) throw new Error("No thumbnail available.");
      const img = await fetch(url);
      if (!img.ok) throw new Error(`Could not fetch thumbnail (${img.status})`);
      return {
        __content: [
          { type: "text", text: `Thumbnail of "${v.snippet.title}" (${url})` },
          {
            type: "image",
            data: toBase64(new Uint8Array(await img.arrayBuffer())),
            mimeType: img.headers.get("content-type") ?? "image/jpeg",
          },
        ],
      };
    },
  }),
  readOnly({
    name: "channel_analytics",
    description:
      "YouTube Analytics over a date range (YYYY-MM-DD): views, watch time, avg view duration, subs gained/lost, likes. byDay=true for daily rows; videoId to scope to one video.",
    inputSchema: obj(
      { startDate: str, endDate: str, byDay: bool(false), videoId: str },
      ["startDate", "endDate"],
    ),
    handler: async (ctx, { startDate, endDate, byDay = false, videoId }) => {
      const res = await ctx.yt.analytics({
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
  }),
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
