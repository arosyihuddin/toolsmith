# Toolsmith

Toolsmith is a native MCP toolchain for AI clients. It exposes workspace file operations, shell execution, filesystem search, desktop automation, host diagnostics, root-command controls, and Cloudflare Quick Tunnel management. The standalone dashboard is Toolsmith Console.

## Status

- Runtime: Bun + TypeScript.
- MCP transports: Streamable HTTP and STDIO.
- Authentication: Bearer token for internal control APIs; optional OAuth 2.0 authorization-code flow with PKCE for remote MCP clients.
- Persistence: local SQLite database with Drizzle migrations.
- Tool calls are governed by server-side exposure, permission, custom-rule, and approval policies.
- Shell execution is NOT a sandbox. Commands can access the host with the service account's permissions.

## Installation (Linux)

Toolsmith installs per user. It does not require root privileges or a system-wide `/opt` installation. The CLI stores its application, configuration, data, logs, and workspace under `~/.toolsmith/` and manages a systemd user service.

Requirements: Linux with systemd, curl, and Git. Bun is installed automatically for the current user if missing.

One-line installation:

    curl -fsSL https://raw.githubusercontent.com/arosyihuddin/toolsmith/main/install.sh | bash

Or, from a clone of this repository:

    bun run src/cli.ts install

The installer creates `~/.toolsmith/`, installs the production build, creates a `toolsmith` command in `~/.local/bin`, and enables/starts `toolsmith.service` through `systemctl --user`. Add `~/.local/bin` to PATH if it is not already present. The generated YAML configuration is `~/.toolsmith/config/config.yml`; persistent SQLite data is detected automatically in `~/.toolsmith/data/`.

After installation, open `http://127.0.0.1:48765/` (or the configured local port) and complete the Initial Setup. Create an administrator username and password; Toolsmith hashes the password and automatically generates the API token and sudo encryption key. Initial Setup is restricted to localhost; use an SSH tunnel if the service runs on another machine. The optional public HTTPS origin enables OAuth discovery for remote MCP clients. After setup, sign in to manage and view or regenerate the API token.

After installation, manage Toolsmith with:

    toolsmith status
    toolsmith logs
    toolsmith restart
    toolsmith update
    toolsmith uninstall

Uninstall preserves configuration and user data. Use `toolsmith uninstall --purge` only when you also want to delete all of `~/.toolsmith/`. The service runs as a systemd user service; enable lingering separately if it must stay active after logout.

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

Installed deployments use `~/.toolsmith/config/config.yml`. Environment variables override YAML values. Existing `.env` configuration is migrated automatically while preserving credentials.

| Variable | Purpose |
| --- | --- |
| TOOLSMITH_API_TOKEN | Internal HTTP/control API Bearer token; legacy fallback OMP_API_TOKEN. |
| TOOLSMITH_DEFAULT_CWD | Default workspace; legacy fallback OMP_DEFAULT_CWD. |
| TOOLSMITH_DATA_DIR | Control-plane database directory; legacy fallback OMP_DATA_DIR. |
| TOOLSMITH_SUDO_ENCRYPTION_KEY | Stable secret of at least 32 characters; legacy fallback OMP_SUDO_ENCRYPTION_KEY. Preserve the existing key when migrating encrypted data. |
| Admin account | Created through the built-in Toolsmith Initial Setup UI; password is stored as a scrypt hash. |
| TOOLSMITH_TERMINAL_ROOT | Root for relative terminal paths; legacy fallback OMP_TERMINAL_ROOT. |
| MCP_PUBLIC_URL | Public HTTPS origin for OAuth discovery and callbacks; configured during Initial Setup or in config.yml. Unset disables remote OAuth. |
| LOG_LEVEL | Log level; defaults to info. |

Example user configuration (config.example.yml):

    server:
      transport: http
      host: 127.0.0.1
      port: 48766
      path: /mcp
    security:
      api_token: replace-with-a-random-secret
      sudo_encryption_key: replace-with-a-stable-secret
    logging:
      level: info
      # directory: ~/.toolsmith/logs

Do not commit tokens, OAuth credentials, sudo passwords, or encryption keys. Changing the sudo encryption key makes previously encrypted passwords unreadable.

## Tool catalog and policy

### Reset administrator password

If the Toolsmith OAuth administrator password is lost, run this command on the
same Linux account that owns the Toolsmith installation:

    toolsmith reset-password

The command prompts for the new password without echoing it, requires at least
12 characters, updates the local administrator credential hash, and revokes
all existing administrator browser sessions. It does not change the API token
or existing OAuth access/refresh tokens. No service restart or sudo access is
required.

GET /api/tools is the source of truth consumed by Toolsmith Console. The catalog includes filesystem/workspace tools, desktop automation, system diagnostics, root-command execution, and tunnel management. Exposure, permissions, custom rules, and approval decisions are enforced by the backend, not by the UI. Root-command allow rules match exact commands and arguments; seeded shutdown/reboot examples remain disabled by default.

A configured working directory is a default cwd, not a filesystem or process sandbox. Treat tool arguments, paths, URLs, browser state, and client metadata as untrusted.

## Toolsmith Console

The dashboard frontend lives in the separate toolsmith-console project and consumes authenticated /api/* endpoints. Update and test both repositories when API contracts change.

## Legacy system installation

The previous system-wide Makefile workflow is archived at `deploy/Makefile.legacy`; templates under `deploy/systemd/` are retained for compatibility with existing hosts. New installations should use the per-user CLI workflow above. Do not run the legacy `make install`, `make update`, `make uninstall`, or `make purge` targets on a host that has an existing Toolsmith/OMP-MCP system service without a planned migration and backup. The CLI installer does not migrate or modify `/opt/omp-mcp`, `/opt/toolsmith`, `/var/lib/omp-mcp`, `/var/lib/toolsmith`, or their system services.

## Engineering rules

See ARCHITECTURE.md for runtime boundaries, lifecycle requirements, security constraints, and testing standards. Keep changes local until typecheck, tests, build, and diff review pass. Deployment is a separate explicit step.
