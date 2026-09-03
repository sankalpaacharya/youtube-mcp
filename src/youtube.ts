import { getAccessToken } from "./auth";

const DATA_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

export class YouTubeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: URL,
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: "application/json" };

  if (token) headers.Authorization = `Bearer ${token}`;
  else if (process.env.YOUTUBE_API_KEY)
    url.searchParams.set("key", process.env.YOUTUBE_API_KEY);
  else
    throw new YouTubeError(
      401,
      "Not authenticated. Run `bun run auth` in the project and open http://localhost:3456/auth/login to connect your YouTube account.",
    );

  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok)
    throw new YouTubeError(
      res.status,
      data?.error?.message ?? `YouTube API error (${res.status})`,
    );
  return data as T;
}

function buildUrl(base: string, path: string, query: Record<string, string | undefined>) {
  const url = new URL(`${base}/${path}`);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined) url.searchParams.set(k, v);
  return url;
}

/** YouTube Data API v3 (videos, playlists, search, channels…). */
export function yt<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  return request<T>(method, buildUrl(DATA_BASE, path, opts.query ?? {}), opts.body);
}

/** Uploads a video thumbnail (JPEG/PNG bytes, max 2MB). Requires OAuth. */
export async function ytSetThumbnail(
  videoId: string,
  image: Uint8Array,
  contentType: string,
): Promise<any> {
  const { getAccessToken } = await import("./auth");
  const token = await getAccessToken();
  if (!token)
    throw new YouTubeError(
      401,
      "Not authenticated. Run `bun run auth` and open http://localhost:3456/auth/login.",
    );
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body: image,
    },
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok)
    throw new YouTubeError(
      res.status,
      data?.error?.message ?? `Thumbnail upload failed (${res.status})`,
    );
  return data;
}

/** YouTube Analytics API v2 (reports). Requires OAuth. */
export function ytAnalytics<T = any>(
  query: Record<string, string | undefined>,
): Promise<T> {
  return request<T>("GET", buildUrl(ANALYTICS_BASE, "reports", query));
}
