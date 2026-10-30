# Deployment

The deployment files support a simple systemd installation.

## Layout

New installations use the following Toolsmith paths. Existing legacy paths are detected and retained when present:

- Application: `/opt/toolsmith`
- Persistent service data: `/var/lib/toolsmith`
- Default Toolsmith working directory: `/var/lib/toolsmith/workspace`
- systemd unit: `/etc/systemd/system/toolsmith.service`

The default workspace is created automatically by the application at startup. The deployment Makefile also creates it during installation.

For an existing installation, the Makefile keeps using `/opt/omp-mcp` and `/var/lib/omp-mcp` when those legacy directories exist and the new paths do not. The systemd unit is renamed to `toolsmith.service`; schedule a maintenance window before switching units because both units must not listen on the same MCP port. Back up the `.env` file and SQLite database before migration.

## Install

From the project root:

```bash
sudo make install
sudo make start
```

Or:

```bash
sudo make setup
```

The installer installs the application and production dependencies, creates the persistent workspace, installs the Toolsmith unit plus optional Browser Relay and ydotoold units, and enables only `toolsmith.service`. The optional units are not started or enabled by default; their failures do not block Toolsmith.

Review `/opt/toolsmith/.env` before starting the service.

## Service management

```bash
sudo make start
sudo make stop
sudo make restart
sudo make status
sudo make logs
```

The default Make targets manage only `toolsmith.service`. Optional integrations can be managed independently when needed:

```bash
sudo make start relay
sudo make start ydotoold
sudo make status relay
sudo make logs ydotoold
```

To enable an optional service at boot, use `sudo systemctl enable --now toolsmith-browser-relay.service` or `sudo systemctl enable --now ydotoold.service`.

## Update

```bash
sudo make update
```

This reinstalls the application files and restarts the service.

## Uninstall

```bash
sudo make uninstall
```

This removes the service and application files but **preserves** `/var/lib/toolsmith`, including Toolsmith workspaces.

To remove everything, including workspaces:

```bash
sudo make purge
```

Use `purge` only when the workspace data is no longer needed.
