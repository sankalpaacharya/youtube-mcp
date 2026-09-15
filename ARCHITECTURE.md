# Architecture

This repository is a pnpm workspace orchestrated with Turborepo.

## Workspace map

```text
apps/
  mcp/      YouTube MCP server and Cloudflare Worker
  web/      Next.js media workspace
packages/   Shared libraries once more than one app needs them
```

Applications are deployable products. Packages are internal building blocks and
must not depend on applications.

## Where new work belongs

- Put web routes, components, and frontend feature logic in `apps/web`.
- Put YouTube tool handling and OAuth behavior in `apps/mcp`.
- Extract a package only after code has two consumers or a genuinely independent
  domain boundary.
- Keep deployment configuration beside the app it deploys.
