const DATA_BASE = "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

export type Query = Record<string, string | undefined>;

export class YouTubeError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class YouTubeClient {
  constructor(private readonly getToken: () => Promise<string>) {}

  data(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<any> {
    return this.request(method, buildUrl(DATA_BASE, path, opts.query), opts.body);
  }

  analytics(query: Query): Promise<any> {
    return this.request("GET", buildUrl(ANALYTICS_BASE, "reports", query));
  }

  async setThumbnail(
    videoId: string,
    bytes: Uint8Array | ArrayBuffer,
    contentType: string,
  ): Promise<any> {
    const url = buildUrl(UPLOAD_BASE, "thumbnails/set", {
      videoId,
      uploadType: "media",
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        "Content-Type": contentType,
      },
      body: bytes as any,
    });
    return parseResponse(res);
  }

  private async request(
    method: string,
    url: URL,
    body?: unknown,
  ): Promise<any> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.getToken()}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseResponse(res);
  }
}

function buildUrl(base: string, path: string, query: Query = {}): URL {
  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) url.searchParams.set(key, value);
  return url;
}

async function parseResponse(res: Response): Promise<any> {
  if (res.status === 204) return undefined;
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok)
    throw new YouTubeError(
      res.status,
      data?.error?.message ?? `YouTube API error (${res.status})`,
    );
  return data;
}
