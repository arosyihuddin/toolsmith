# Legacy system deployment assets

These files are retained only for existing system-wide Toolsmith/OMP-MCP deployments. They are not used by the current installer. New installations must use the per-user CLI workflow in the root README.

The former system-wide Makefile is archived as `Makefile.legacy`. Its commands require root privileges and manage `/opt`, `/var/lib`, and `/etc/systemd/system`; do not use it for a new installation. Do not run a user service and a legacy system service on the same MCP port.
