export const videoUrl = (id: string) => `https://youtube.com/watch?v=${id}`;

export function thumbOf(snippet: any): string | undefined {
  const t = snippet?.thumbnails;
  return (t?.maxres ?? t?.high ?? t?.medium ?? t?.default)?.url;
}

export function fmtDuration(iso?: string): string | undefined {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return iso;
  const [, h, min, s] = m;
  const mm = h ? String(min ?? 0).padStart(2, "0") : String(min ?? 0);
  return `${h ? `${h}:` : ""}${mm}:${String(s ?? 0).padStart(2, "0")}`;
}

export const num = (v: unknown) => (v === undefined ? undefined : Number(v));

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
