# Contributing

## Organization and ownership

Use [ARCHITECTURE.md](ARCHITECTURE.md) to decide which app or package owns code.
Keep deployable apps independent: an app must not import another app's source.
Shared packages depend on other packages, never on apps. Declare shared package
dependencies with `workspace:*` and import through their public exports.

In `apps/web`, keep Next.js routes and layouts under `app/`. Colocate route-only
components in that route's `_components/` directory. Once multiple routes use a
component, move it to `components/`, grouped by feature; reserve `components/ui/`
for reusable visual primitives. Put shared web helpers in `lib/` and reusable
client hooks in `hooks/`. Create these directories when they contain real code.

In `apps/mcp/src`, entry points wire together `lib/` domain/API behavior,
`routes/` HTTP handling, `stores/` persistence, and `utils/` small helpers.
Keep Bun-specific file access out of the Worker dependency graph.

## Names and imports

- Use kebab-case for ordinary files and directories, including components:
  `thumbnail-preview.tsx`. Keep framework-defined filenames such as `page.tsx`,
  `layout.tsx`, and dynamic route segments as Next.js requires.
- Use PascalCase for components, classes, and types; camelCase for functions and
  values; `use` prefixes for React hooks; uppercase names for module constants.
- Prefer named exports for application modules. Use default exports where the
  framework or tool expects them, such as Next.js routes and configuration.
- Use relative imports within a feature. In the web app, use `@/` for imports
  across features. Import concrete modules rather than adding barrel files just
  to shorten paths. Use `import type` when only the type is needed.
- Keep app-specific dependencies in the owning app's manifest and shared
  development tools at the root. Use pnpm to update the committed lockfile.

## Implementation

Use strict TypeScript and validate external input at the boundary. New code
should use `unknown` and narrow it instead of introducing `any`. Existing MCP
adapter exceptions are documented in ARCHITECTURE.md; narrowing or removing them
requires preserving the adapter's behavior.

Keep Server Components as the web default. Add `"use client"` at the smallest
interactive boundary, and keep credentials and server integrations out of client
modules. Prefer semantic HTML and existing CSS tokens. Extract components when
they have a distinct responsibility or repeat, rather than splitting every block.

Prettier owns formatting and Oxlint owns code checks. Keep rule exceptions local
and explain why they are needed. Add focused behavioral tests when changing
logic; colocate them as `*.test.ts` or `*.test.tsx` when a test runner is added.
Document manual verification where automated coverage is not available.

## Changes and pull requests

Run `pnpm check` before handing off a change. Its current build step validates
the web app; MCP is typechecked and linted. Deployment remains an explicit step.

Use `codex/<short-description>` for agent branches. Commits and PR titles follow
`type(scope): description`, with an optional scope: for example,
`feat(web): add thumbnail editor` or `fix(mcp): handle expired credentials`.
Use `feat`, `fix`, `refactor`, `docs`, `test`, or `chore` to describe the change.

PR descriptions explain the resulting behavior, migration steps, and checks
actually run. Keep commits focused and preserve local environment/token files;
publish placeholder values only in example configuration.
