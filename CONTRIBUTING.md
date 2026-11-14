# Contributing to Toolsmith

## Before changing code

1. Read `README.md` for installation, configuration, tools, and deployment.
2. Read `ARCHITECTURE.md` to understand runtime modules and trust boundaries.
3. Read `DESIGN.md` for hosted interface and API conventions.
4. Check `git status --short`; preserve existing uncommitted changes.

## Requirements and local development

- Bun 1.4 or later.
- An authenticated compatible runtime/model environment for runtime integration checks.
- Linux for the recommended systemd deployment and host operations.

Install and run:

```bash
bun install
bun run dev
```

For a normal start:

```bash
bun run start
```

For installed deployments, configure ~/.toolsmith/config/config.yml; use config.example.yml as the YAML template. Environment variables may override YAML values. Keep real credentials and secrets out of Git. The root .env is only for local development/legacy workflows.

## Validation

Run the project checks:

```bash
bun run typecheck
bun test
```

Add or update tests for changes to tool registration, policy evaluation, authentication, API validation, persistence, and lifecycle behavior. Integration checks that require a live compatible runtime, browser extension, sudo configuration, cloudflared, or external OAuth client should be identified explicitly rather than represented as unit-tested.

## Runtime and API conventions

- Register tools through the established tool-registration modules.
- Keep `GET /api/tools` as the authoritative catalog for Toolsmith Console; do not create a second dashboard-side catalog.
- Enforce tool exposure and permissions on the server before execution.
- Validate and normalize custom rules at the API boundary and preserve compatibility with existing stored rules where intended.
- Require internal Bearer authentication for protected control APIs.
- Keep OAuth client authorization distinct from Toolsmith Console browser authentication.
- Preserve MCP Streamable HTTP session behavior, SSE event streams, and terminal WebSocket lifecycle.
- Avoid exposing secrets or sensitive collaboration links in logs and responses.

## Persistence and migrations

- Persist durable control-plane state in the SQLite schema using Drizzle.
- Add a migration for schema changes and ensure it is applied by the existing startup migration flow.
- Do not rely on manually editing deployed databases.
- Document new configuration keys in config.example.yml and README.md. Document every supported environment variable in README.md and config.example.yml.

## Host operations and security

- Treat system commands, filesystem paths, remote MCP input, and browser sessions as untrusted.
- Keep root-command allowlists narrow; use exact argument matching and preserve disabled-by-default seeded rules.
- Never add shell interpolation, command chaining, or wildcard behavior to root-command rules without a deliberate security design and tests.
- Keep tunnel targets constrained to loopback HTTP(S) URLs and validate input before spawning processes.
- Do not run privileged operations or deploy/restart services as part of routine validation unless explicitly required and authorized.

## Documentation

Update `README.md`, `ARCHITECTURE.md`, `DESIGN.md`, and this guide when behavior or conventions change. Keep documentation aligned with the implementation, including limitations and deployment-specific differences.
