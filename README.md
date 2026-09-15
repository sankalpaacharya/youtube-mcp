# youtube-media

A pnpm monorepo for a future end-to-end media pipeline. It currently contains a
Next.js workspace and the existing YouTube MCP server.

## Structure

```text
apps/
  web/      Next.js frontend
  mcp/      YouTube MCP server and Cloudflare Worker
packages/   Future shared UI, media, and configuration packages
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the ownership rules behind the layout.

## Start the frontend

```sh
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful workspace commands:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
```

## YouTube MCP server

The MCP app still provides the YouTube tools for videos, playlists, thumbnails,
and analytics.

```sh
cp apps/mcp/.env.example apps/mcp/.env
pnpm auth
pnpm mcp
```

For Claude Code, point the local MCP command at:

```sh
pnpm --dir /absolute/path/to/youtube-mcp --filter @youtube-media/mcp mcp
```

Cloudflare configuration lives beside the service in `apps/mcp/wrangler.jsonc`.
If you already had a personalized root configuration, it has been preserved as
the ignored `apps/mcp/wrangler.local.jsonc`; deploy it with `pnpm --filter
@youtube-media/mcp deploy:local`.

## License

[MIT](LICENSE)
