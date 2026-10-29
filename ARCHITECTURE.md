# Toolsmith Architecture and Engineering Rules

This document defines implementation constraints for Toolsmith. Keep it aligned with the code. The server—not Toolsmith Console—is the security boundary.

## Runtime boundaries

- src/index.ts owns startup, MCP transport setup, HTTP routing, WebSocket upgrades, and ordered shutdown.
- src/mcp/server.ts creates the MCP server; src/mcp/tools/ owns tool registration and handlers.
- src/mcp/tools/register.ts is the enforcement point for exposure, permission policy, custom rules, approvals, and call logging. User-callable tools must not bypass it.
- src/control-plane/ owns tool metadata, permission decisions, persistence, and Drizzle migrations.
- src/dashboard/ owns the authenticated API consumed by Toolsmith Console; it does not serve the console frontend.
- src/terminal/ owns interactive shell sessions and WebSocket I/O.
- src/tunnels/ owns managed Cloudflare Quick Tunnel process records and lifecycle.
- src/approval/ owns pending approval state and cancellation.
- src/lib/config.ts is the canonical environment configuration surface.

## Tool implementation rules

1. Register user-callable tools through registerExposedTool so policy and logging cannot be skipped accidentally.
2. Mark annotations accurately. Read-only annotations do not replace input/path validation.
3. Validate inputs at the boundary. Bound result counts, output size, timeout duration, and accepted ranges.
4. Never claim shell execution is sandboxed. A configured cwd is not a filesystem or process sandbox.
5. Treat paths, commands, URLs, browser state, and identifiers as untrusted.
6. Never log secrets, passwords, authorization headers, OAuth codes, or sensitive payloads.
7. For state-changing tools, preserve approval behavior and test allow, approval, deny/block, timeout, and cancellation as applicable.

## Process and resource lifecycle

- Every subprocess needs an owner, timeout policy, abort behavior, bounded output capture, and exit/stream handling.
- Temporary children must be awaited on success, failure, timeout, abort, and shutdown. Signal process groups only when Toolsmith created and owns those groups.
- A deliberately backgrounded process needs explicit tracking and stop semantics.
- Terminal shutdown must dispose every managed terminal, close WebSocket clients, wait for exit within a bound, and force-kill only as fallback.
- Shutdown must be idempotent and stop accepting new work before disposing resources.
- Do not infer a leak from a worker's name or age. Measure PID, RSS/PSS, process count, thread count, cgroup memory, and workload.

## Persistence and configuration

- SQLite schema changes require a Drizzle migration; do not edit production data manually.
- Tests must use NODE_ENV=test and isolated data. Never run tests against /var/lib/omp-mcp or another production database.
- Prefer TOOLSMITH_* variables. Legacy OMP_* aliases remain temporarily. Do not remove aliases, change data paths, rotate encryption keys, or rename service units until migration is tested.
- The production data-directory fallback remains /var/lib/omp-mcp during this transition by design. Source branding does not authorize moving existing data.

## API and console compatibility

- The backend is authoritative for exposure and execution permissions.
- Endpoint changes must update auth, method validation, tests, and docs together.
- Keep Toolsmith Console clients aligned with the backend API. Test changes in the separate console repository independently.
- Keep legacy service/path references only where required for documented compatibility; do not introduce new dependencies on those names.

## Validation workflow

Run in the local development checkout:

    bun run typecheck
    bun test
    bun run build
    git diff --check

HTTP integration tests must use a dedicated loopback port and test credentials. Add regression tests for process cleanup, timeout, abort, and output caps when changing subprocess code. Review git status and the complete diff; do not overwrite unrelated changes. Do not run systemd commands, production migrations, install/update/purge scripts, or deployment commands as part of tests. Commit, publish, and deploy only when explicitly authorized.
