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

## Checks

`pnpm check` runs typechecking, type-aware Oxlint, formatting, and the web build.
Filtered app lint commands use the same root Oxlint configuration and fail on
warnings. Next.js route types are generated before web typechecking; typechecks
are uncached so generated declarations are always available.

The existing MCP JSON adapters still use dynamic types. Oxlint exceptions name
those specific files; new files inherit the strict defaults. The tool registry
also permits sequential requests for pagination and bounded API batches, and
the CLI entry points permit console output. These exceptions preserve existing
behavior until the adapters receive validated response schemas.
