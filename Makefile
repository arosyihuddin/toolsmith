BUN ?= bun

.PHONY: help cli install update start stop restart status logs uninstall purge test typecheck build

help:
	@echo "Toolsmith"
	@echo ""
	@echo "  make install    Install per-user under ~/.toolsmith (no sudo)"
	@echo "  make update     Update the per-user installation"
	@echo "  make start      Start the systemd user service"
	@echo "  make stop       Stop the systemd user service"
	@echo "  make restart    Restart the systemd user service"
	@echo "  make status     Show service status"
	@echo "  make logs       Follow service logs"
	@echo "  make uninstall  Remove app, preserve user data"
	@echo "  make purge      Remove app and all ~/.toolsmith data"
	@echo ""
	@echo "  make test       Run tests"
	@echo "  make typecheck  Run TypeScript typecheck"
	@echo "  make build      Build the MCP server"

cli:
	$(BUN) run src/cli.ts

install:
	$(BUN) run src/cli.ts install

update:
	$(BUN) run src/cli.ts update

start:
	$(BUN) run src/cli.ts start

stop:
	$(BUN) run src/cli.ts stop

restart:
	$(BUN) run src/cli.ts restart

status:
	$(BUN) run src/cli.ts status

logs:
	$(BUN) run src/cli.ts logs

uninstall:
	$(BUN) run src/cli.ts uninstall

purge:
	$(BUN) run src/cli.ts uninstall --purge

test:
	$(BUN) test

typecheck:
	$(BUN) run typecheck

build:
	$(BUN) run build
