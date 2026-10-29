# Toolsmith

Toolsmith is a native MCP toolchain for AI clients. It exposes workspace file operations, shell execution, filesystem search, desktop automation, host diagnostics, root-command controls, and Cloudflare Quick Tunnel management. The standalone dashboard is Toolsmith Console.

## Status

- Runtime: Bun + TypeScript.
- MCP transports: Streamable HTTP and STDIO.
- Authentication: Bearer token for internal control APIs; optional OAuth 2.0 authorization-code flow with PKCE for remote MCP clients.
- Persistence: local SQLite database with Drizzle migrations.
- Tool calls are governed by server-side exposure, permission, custom-rule, and approval policies.
- Shell execution is NOT a sandbox. Commands can access the host with the service account's permissions.

## Development

Requirements: Bun 1.4+ and Linux for the recommended deployment and desktop integrations.

    bun install
    bun run dev

Validate changes locally:

    bun run typecheck
    bun test
    bun run build

HTTP integration tests use an isolated test environment and dedicated loopback ports. Never point tests at a production port, database, or credentials.

## MCP connection

Default Streamable HTTP endpoint: http://127.0.0.1:48765/mcp

Choose transport with MCP_TRANSPORT=http|stdio|both. Configure the listener using MCP_HTTP_HOST, MCP_HTTP_PORT, and MCP_HTTP_PATH.

## Configuration

Use TOOLSMITH-prefixed variables for new installations. Legacy OMP-prefixed aliases remain accepted during migration.

| Variable | Purpose |
| --- | --- |
| TOOLSMITH_API_TOKEN | Internal HTTP/control API Bearer token; legacy fallback OMP_API_TOKEN. |
| TOOLSMITH_DEFAULT_CWD | Default workspace; legacy fallback OMP_DEFAULT_CWD. |
| TOOLSMITH_DATA_DIR | Control-plane database directory; legacy fallback OMP_DATA_DIR. |
| TOOLSMITH_SUDO_ENCRYPTION_KEY | Stable secret of at least 32 characters; legacy fallback OMP_SUDO_ENCRYPTION_KEY. Preserve the existing key when migrating encrypted data. |
| TOOLSMITH_OAUTH_USERNAME / TOOLSMITH_OAUTH_PASSWORD | Optional OAuth login credentials; legacy fallbacks OMP_OAUTH_USERNAME / OMP_OAUTH_PASSWORD. |
| TOOLSMITH_TERMINAL_ROOT | Root for relative terminal paths; legacy fallback OMP_TERMINAL_ROOT. |
| MCP_PUBLIC_URL | Public HTTPS origin for OAuth discovery and callbacks. Unset disables OAuth. |
| LOG_LEVEL | Log level; defaults to info. |

Example development environment:

    NODE_ENV=development
    LOG_LEVEL=info
    MCP_TRANSPORT=http
    MCP_HTTP_HOST=127.0.0.1
    MCP_HTTP_PORT=48765
    MCP_HTTP_PATH=/mcp
    TOOLSMITH_API_TOKEN=replace-with-a-random-secret
    TOOLSMITH_DEFAULT_CWD=/path/to/workspace
    TOOLSMITH_DATA_DIR=./data

Do not commit tokens, OAuth credentials, sudo passwords, or encryption keys. Changing the sudo encryption key makes previously encrypted passwords unreadable.

## Tool catalog and policy

GET /api/tools is the source of truth consumed by Toolsmith Console. The catalog includes filesystem/workspace tools, desktop automation, system diagnostics, root-command execution, and tunnel management. Exposure, permissions, custom rules, and approval decisions are enforced by the backend, not by the UI. Root-command allow rules match exact commands and arguments; seeded shutdown/reboot examples remain disabled by default.

A configured working directory is a default cwd, not a filesystem or process sandbox. Treat tool arguments, paths, URLs, browser state, and client metadata as untrusted.

## Toolsmith Console

The dashboard frontend lives in the separate toolsmith-console project and consumes authenticated /api/* endpoints. Update and test both repositories when API contracts change.

## Legacy deployment migration boundary

Deployment scripts and systemd templates in this checkout still contain legacy names and paths, including /opt/omp-mcp, /var/lib/omp-mcp, and omp-mcp.service. They have NOT been renamed as part of this local source rebrand. Do not run install/update/uninstall/purge targets against an existing host until a non-production migration and rollback procedure has been validated. Existing paths, service units, secrets, database contents, permissions, and ownership must be preserved during migration.

## Engineering rules

See ARCHITECTURE.md for runtime boundaries, lifecycle requirements, security constraints, and testing standards. Keep changes local until typecheck, tests, build, and diff review pass. Deployment is a separate explicit step.
