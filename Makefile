APP_NAME := toolsmith
LEGACY_APP_NAME := omp-mcp
LEGACY_INSTALL_DIR := /opt/$(LEGACY_APP_NAME)
LEGACY_DATA_DIR := /var/lib/$(LEGACY_APP_NAME)
INSTALL_DIR ?= $(if $(wildcard /opt/$(APP_NAME)),/opt/$(APP_NAME),$(if $(wildcard $(LEGACY_INSTALL_DIR)),$(LEGACY_INSTALL_DIR),/opt/$(APP_NAME)))
SERVICE_NAME := $(APP_NAME).service
RELAY_SERVICE_NAME := $(APP_NAME)-browser-relay.service
YDOTOOL_SERVICE_NAME := ydotoold.service
DATA_DIR ?= $(if $(wildcard /var/lib/$(APP_NAME)),/var/lib/$(APP_NAME),$(if $(wildcard $(LEGACY_DATA_DIR)),$(LEGACY_DATA_DIR),/var/lib/$(APP_NAME)))
WORKSPACE_DIR := $(DATA_DIR)/workspace
SERVICE_USER ?= $(or $(SUDO_USER),$(shell id -un))
SERVICE_GROUP ?= $(shell id -gn $(SERVICE_USER))
SERVICE_HOME := $(shell getent passwd $(SERVICE_USER) | cut -d: -f6)
SYSTEMD_DIR := /etc/systemd/system

# Override with `make BUN=/path/to/bun setup` when needed.
# Otherwise, resolve Bun from PATH or from the invoking user's ~/.bun install.
BUN ?= $(shell command -v bun 2>/dev/null || true)
ifneq ($(strip $(BUN)),)
else
BUN := $(SERVICE_HOME)/.bun/bin/bun
endif


.PHONY: help setup install update build uninstall purge start stop restart status logs token oauth ydotoold toolsmith omp relay test typecheck release

help:
	@echo "Toolsmith - available targets"
	@echo ""
	@echo "  setup       Install and enable the systemd services"
	@echo "  token       Display the configured Toolsmith API Bearer token"
	@echo "  oauth       Display the configured OAuth URL, username, and password"
	@echo "  install     Install the application and systemd services"
	@echo "  update      Reinstall the application and restart the services"
	@echo "  uninstall   Remove the services and application (preserve data)"
	@echo "  purge       Uninstall and remove all service data/workspaces"
	@echo ""
	@echo "  start [service]   Start Toolsmith, or one: ydotoold|toolsmith|omp|relay"
	@echo "  stop [service]    Stop Toolsmith, or one: ydotoold|toolsmith|omp|relay"
	@echo "  restart [service] Restart Toolsmith, or one: ydotoold|toolsmith|omp|relay"
	@echo "  status [service]  Show Toolsmith status, or one: ydotoold|toolsmith|omp|relay"
	@echo "  logs [service]    Follow Toolsmith logs, or one: ydotoold|toolsmith|omp|relay"
	@echo ""
	@echo "  ydotoold        ydotoold service name"
	@echo "  toolsmith       Toolsmith service name (omp remains a legacy alias)"
	@echo "  relay           Browser Relay service name"
	@echo ""
	@echo "  test        Run tests"
	@echo "  typecheck   Run TypeScript typecheck"
	@echo ""
	@echo "  build       Bundle the server for production (external dependencies remain in node_modules)"
	@echo "  release     Create and push a SemVer Git release (VERSION=x.y.z)"

# These targets intentionally print secrets to the terminal. Run only in a trusted session.
token:
	@test -r $(INSTALL_DIR)/.env || { echo "Cannot read $(INSTALL_DIR)/.env; try sudo make token."; exit 1; }
	@cd $(INSTALL_DIR) && $(INSTALL_DIR)/bin/bun -e 'const token = process.env.TOOLSMITH_API_TOKEN ?? process.env.OMP_API_TOKEN ?? ""; if (!token) { console.error("TOOLSMITH_API_TOKEN is not configured."); process.exit(1); } console.log("TOOLSMITH_API_TOKEN=" + token);'

oauth:
	@test -r $(INSTALL_DIR)/.env || { echo "Cannot read $(INSTALL_DIR)/.env; try sudo make oauth."; exit 1; }
	@cd $(INSTALL_DIR) && $(INSTALL_DIR)/bin/bun -e 'const url = process.env.MCP_PUBLIC_URL ?? ""; const username = process.env.TOOLSMITH_OAUTH_USERNAME ?? process.env.OMP_OAUTH_USERNAME ?? ""; const password = process.env.TOOLSMITH_OAUTH_PASSWORD ?? process.env.OMP_OAUTH_PASSWORD ?? ""; console.log("OAuth status=" + (url && username && password ? "configured" : "disabled/incomplete")); console.log("MCP_PUBLIC_URL=" + (url || "(not set)")); console.log("TOOLSMITH_OAUTH_USERNAME=" + (username || "(not set)")); console.log("TOOLSMITH_OAUTH_PASSWORD=" + (password || "(not set)"));'

start:
	@if echo " $(MAKECMDGOALS) " | grep -q " ydotoold "; then systemctl start $(YDOTOOL_SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -Eq " (toolsmith|omp) "; then systemctl start $(SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -q " relay "; then systemctl start $(RELAY_SERVICE_NAME); else systemctl start $(SERVICE_NAME); fi

stop:
	@if echo " $(MAKECMDGOALS) " | grep -q " ydotoold "; then systemctl stop $(YDOTOOL_SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -Eq " (toolsmith|omp) "; then systemctl stop $(SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -q " relay "; then systemctl stop $(RELAY_SERVICE_NAME); else systemctl stop $(SERVICE_NAME); fi

restart:
	@if echo " $(MAKECMDGOALS) " | grep -q " ydotoold "; then systemctl restart $(YDOTOOL_SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -Eq " (toolsmith|omp) "; then systemctl restart $(SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -q " relay "; then systemctl restart $(RELAY_SERVICE_NAME); else systemctl restart $(SERVICE_NAME); fi

status:
	@if echo " $(MAKECMDGOALS) " | grep -q " ydotoold "; then systemctl status $(YDOTOOL_SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -Eq " (toolsmith|omp) "; then systemctl status $(SERVICE_NAME); elif echo " $(MAKECMDGOALS) " | grep -q " relay "; then systemctl status $(RELAY_SERVICE_NAME); else systemctl status $(SERVICE_NAME); fi

logs:
	@if echo " $(MAKECMDGOALS) " | grep -q " ydotoold "; then journalctl -u $(YDOTOOL_SERVICE_NAME) -f; elif echo " $(MAKECMDGOALS) " | grep -Eq " (toolsmith|omp) "; then journalctl -u $(SERVICE_NAME) -f; elif echo " $(MAKECMDGOALS) " | grep -q " relay "; then journalctl -u $(RELAY_SERVICE_NAME) -f; else journalctl -u $(SERVICE_NAME) -f; fi

ydotoold:
	@:

toolsmith:
	@:

# Legacy target alias.
omp:
	@:

relay:
	@:


setup:
	@test "$$(id -u)" = "0" || (echo "Run 'make setup' as root (use sudo)." && exit 1)
	@set -a; if [ -f $(INSTALL_DIR)/.env ]; then . $(INSTALL_DIR)/.env; fi; set +a; \
		transport="$${MCP_TRANSPORT:-http}"; host="$${MCP_HTTP_HOST:-127.0.0.1}"; port="$${MCP_HTTP_PORT:-48765}"; \
		api_token="$${TOOLSMITH_API_TOKEN:-$${OMP_API_TOKEN:-}}"; sudo_key="$${TOOLSMITH_SUDO_ENCRYPTION_KEY:-$${OMP_SUDO_ENCRYPTION_KEY:-}}"; oauth_url="$${MCP_PUBLIC_URL:-}"; oauth_user="$${TOOLSMITH_OAUTH_USERNAME:-$${OMP_OAUTH_USERNAME:-toolsmith}}"; oauth_password="$${TOOLSMITH_OAUTH_PASSWORD:-$${OMP_OAUTH_PASSWORD:-}}"; \
		if [ -f $(INSTALL_DIR)/.env ]; then \
			printf 'Existing configuration found in $(INSTALL_DIR)/.env. Change it? [y/N]: '; read change; \
			case "$$change" in y|Y) ;; *) echo "Keeping existing configuration."; exit 0;; esac; \
		fi; \
		printf 'MCP transport ['"$$transport"']: '; read value; transport="$${value:-$$transport}"; \
		case "$$transport" in stdio|http|both) ;; *) echo "Invalid transport: $$transport"; exit 1;; esac; \
		printf 'MCP HTTP host ['"$$host"']: '; read value; host="$${value:-$$host}"; \
		printf 'MCP HTTP port ['"$$port"']: '; read value; port="$${value:-$$port}"; \
		printf '%s\n' "$$port" | grep -Eq '^[0-9]+$$' || { echo "Invalid port: $$port"; exit 1; }; \
		[ "$$port" -ge 1 ] && [ "$$port" -le 65535 ] || { echo "Port must be between 1 and 65535."; exit 1; }; \
		if [ -z "$$api_token" ]; then api_token="$$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"; echo "Generated TOOLSMITH_API_TOKEN (256-bit)."; fi; \
		if [ -z "$$sudo_key" ]; then sudo_key="$$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"; echo "Generated TOOLSMITH_SUDO_ENCRYPTION_KEY (256-bit)."; fi; \
		printf 'OAuth public HTTPS origin ['"$$oauth_url"'] (Enter keeps current; - disables): '; read value; if [ "$$value" = "-" ]; then oauth_url=""; elif [ -n "$$value" ]; then oauth_url="$$value"; fi; \
		if [ -n "$$oauth_url" ]; then \
			printf 'Toolsmith OAuth username ['"$$oauth_user"']: '; read value; oauth_user="$${value:-$$oauth_user}"; \
			if [ -n "$$oauth_password" ]; then printf 'Toolsmith OAuth password [press Enter to keep existing; input hidden]: '; else printf 'Toolsmith OAuth password (required; input hidden): '; fi; \
			stty -echo; read oauth_input; stty echo; printf '\n'; if [ -n "$$oauth_input" ]; then oauth_password="$$oauth_input"; fi; \
			[ -n "$$oauth_user" ] && [ -n "$$oauth_password" ] || { echo "OAuth username/password cannot be empty."; exit 1; }; \
		else oauth_user="toolsmith"; oauth_password=""; fi; \
		$(MAKE) install SETUP_TRANSPORT="$$transport" SETUP_HOST="$$host" SETUP_PORT="$$port"; \
		SETUP_ENV_FILE="$(INSTALL_DIR)/.env" TOOLSMITH_SETUP_API_TOKEN="$$api_token" TOOLSMITH_SETUP_SUDO_KEY="$$sudo_key" TOOLSMITH_SETUP_OAUTH_URL="$$oauth_url" TOOLSMITH_SETUP_OAUTH_USER="$$oauth_user" TOOLSMITH_SETUP_OAUTH_PASSWORD="$$oauth_password" /bin/sh $(INSTALL_DIR)/deploy/configure-setup-env.sh

install:
	@test "$$(id -u)" = "0" || (echo "Run 'make install' as root (use sudo)." && exit 1)
	@command -v $(BUN) >/dev/null 2>&1 || (echo "Bun not found at $(BUN)." && exit 1)
	install -d -o $(SERVICE_USER) -g $(SERVICE_GROUP) -m 0755 $(INSTALL_DIR)
	install -d -o $(SERVICE_USER) -g $(SERVICE_GROUP) -m 0755 $(INSTALL_DIR)/bin
	install -d -o $(SERVICE_USER) -g $(SERVICE_GROUP) -m 0755 $(DATA_DIR)
	install -d -o $(SERVICE_USER) -g $(SERVICE_GROUP) -m 0755 $(WORKSPACE_DIR)
	cp -a src package.json bun.lock tsconfig.json README.md .env.example deploy $(INSTALL_DIR)/
	install -m 0755 $(BUN) $(INSTALL_DIR)/bin/bun
	@if [ ! -f $(INSTALL_DIR)/.env ]; then cp $(INSTALL_DIR)/.env.example $(INSTALL_DIR)/.env; fi
	@if [ -f $(INSTALL_DIR)/.env ]; then \
		for key in MCP_PUBLIC_URL TOOLSMITH_OAUTH_USERNAME TOOLSMITH_OAUTH_PASSWORD; do \
			if ! grep -q "^$$key=" $(INSTALL_DIR)/.env; then \
				printf '\n# Optional OAuth 2.0 setting; leave empty to keep OAuth disabled.\n%s=\n' "$$key" >> $(INSTALL_DIR)/.env; \
			fi; \
		done; \
	fi
	@if [ -n "$(SETUP_TRANSPORT)" ]; then \
		sed -i 's|^MCP_TRANSPORT=.*|MCP_TRANSPORT=$(SETUP_TRANSPORT)|' $(INSTALL_DIR)/.env; \
		sed -i 's|^MCP_HTTP_HOST=.*|MCP_HTTP_HOST=$(SETUP_HOST)|' $(INSTALL_DIR)/.env; \
	fi
	cd $(INSTALL_DIR) && $(INSTALL_DIR)/bin/bun install --production --frozen-lockfile && PATH="$(INSTALL_DIR)/bin:$$PATH" $(INSTALL_DIR)/bin/bun run build
	rm -rf $(INSTALL_DIR)/src
	chown -R $(SERVICE_USER):$(SERVICE_GROUP) $(INSTALL_DIR)
	chown -R $(SERVICE_USER):$(SERVICE_GROUP) $(DATA_DIR)
	chmod 0750 $(INSTALL_DIR)
	chmod 0640 $(INSTALL_DIR)/.env
	install -m 0644 deploy/systemd/toolsmith.service.example $(SYSTEMD_DIR)/$(SERVICE_NAME)
	install -m 0644 deploy/systemd/ydotoold.service.example $(SYSTEMD_DIR)/$(YDOTOOL_SERVICE_NAME)
	install -m 0644 deploy/systemd/toolsmith-browser-relay.service.example $(SYSTEMD_DIR)/$(RELAY_SERVICE_NAME)
	sed -i 's|^User=.*|User=$(SERVICE_USER)|; s|^Group=.*|Group=$(SERVICE_GROUP)|; s|^WorkingDirectory=.*|WorkingDirectory=$(INSTALL_DIR)|; s|^EnvironmentFile=.*|EnvironmentFile=$(INSTALL_DIR)/.env|; s|^Environment=HOME=.*|Environment=HOME=$(SERVICE_HOME)|; s|^Environment=PATH=.*|Environment=PATH=$(INSTALL_DIR)/bin:/usr/local/bin:/usr/bin:/bin|' $(SYSTEMD_DIR)/$(SERVICE_NAME)
	sed -i 's|^ExecStart=.*|ExecStart=$(INSTALL_DIR)/bin/bun run dist/index.js|' $(SYSTEMD_DIR)/$(SERVICE_NAME)
	sed -i 's|^User=.*|User=$(SERVICE_USER)|; s|^Group=.*|Group=$(SERVICE_GROUP)|' $(SYSTEMD_DIR)/$(YDOTOOL_SERVICE_NAME)
	sed -i 's|^User=.*|User=$(SERVICE_USER)|; s|^Group=.*|Group=$(SERVICE_GROUP)|; s|^Environment=HOME=.*|Environment=HOME=$(SERVICE_HOME)|; s|^Environment=PATH=.*|Environment=PATH=$(SERVICE_HOME)/.bun/bin:/usr/local/bin:/usr/bin:/bin|; s|^ExecStart=.*|ExecStart=$(SERVICE_HOME)/.bun/bin/omp browser-relay|' $(SYSTEMD_DIR)/$(RELAY_SERVICE_NAME)
	systemctl daemon-reload
	systemctl enable $(SERVICE_NAME)
	@echo "Installed $(APP_NAME) and optional ydotoold/Browser Relay units. Only $(SERVICE_NAME) is enabled by default."
	@echo "Start optional services when needed: sudo make start ydotoold  |  sudo make start relay"

update:
	@test "$$(id -u)" = "0" || (echo "Run 'make update' as root (use sudo)." && exit 1)
	@set -eu; \
	source_dir="$(CURDIR)"; tmp=""; \
	if [ -n "$(VERSION)" ]; then \
		version="$(VERSION)"; version="$${version#v}"; \
		printf '%s\n' "$$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$$' || { echo "Invalid release version: $(VERSION)"; exit 1; }; \
		git fetch --tags origin; \
		git rev-parse --verify "refs/tags/v$$version" >/dev/null 2>&1 || { echo "Git tag v$$version not found."; exit 1; }; \
		tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT INT TERM; \
		git archive --format=tar "v$$version" | tar -xf - -C "$$tmp"; source_dir="$$tmp"; \
	fi; \
	test -d "$(INSTALL_DIR)" || { echo "Installation not found at $(INSTALL_DIR); run 'make install' first."; exit 1; }; \
	echo "[update] Syncing source to build a production bundle; preserving $(INSTALL_DIR)/.env and other systemd settings."; \
	rm -rf "$(INSTALL_DIR)/src" "$(INSTALL_DIR)/dist"; cp -a "$$source_dir/src" "$(INSTALL_DIR)/src"; \
	install -m 0644 "$$source_dir/package.json" "$$source_dir/bun.lock" "$$source_dir/tsconfig.json" "$(INSTALL_DIR)/"; \
	cd "$(INSTALL_DIR)" && "$(INSTALL_DIR)/bin/bun" install --production --frozen-lockfile; \
	PATH="$(INSTALL_DIR)/bin:$$PATH" "$(INSTALL_DIR)/bin/bun" run build; \
	rm -rf "$(INSTALL_DIR)/src"; \
	chown -R "$(SERVICE_USER):$(SERVICE_GROUP)" "$(INSTALL_DIR)/dist" "$(INSTALL_DIR)/node_modules"; \
	chown "$(SERVICE_USER):$(SERVICE_GROUP)" "$(INSTALL_DIR)/package.json" "$(INSTALL_DIR)/bun.lock" "$(INSTALL_DIR)/tsconfig.json"; \
	echo "[update] Build complete. Updating systemd ExecStart and restarting $(SERVICE_NAME)."; \
	sed -i 's|^ExecStart=.*|ExecStart=$(INSTALL_DIR)/bin/bun run dist/index.js|' "$(SYSTEMD_DIR)/$(SERVICE_NAME)"; \
	systemctl daemon-reload; \
	systemctl restart "$(SERVICE_NAME)"; \
	echo "[update] Updated build artifact; environment file was not modified."



uninstall:
	@test "$$(id -u)" = "0" || (echo "Run 'make uninstall' as root (use sudo)." && exit 1)
	@echo "[uninstall] Stopping and disabling $(SERVICE_NAME) and $(RELAY_SERVICE_NAME)..."
	@for service in $(SERVICE_NAME) $(RELAY_SERVICE_NAME) $(YDOTOOL_SERVICE_NAME); do \
		if systemctl cat $$service >/dev/null 2>&1; then \
			systemctl disable --now $$service; \
		else \
			echo "[uninstall] $$service not found (already removed)."; \
		fi; \
	done
	@echo "[uninstall] Reloading systemd..."
	systemctl daemon-reload
	@echo "[uninstall] Removing systemd units..."
	rm -f $(SYSTEMD_DIR)/$(SERVICE_NAME) $(SYSTEMD_DIR)/$(RELAY_SERVICE_NAME) $(SYSTEMD_DIR)/$(YDOTOOL_SERVICE_NAME)
	@echo "[uninstall] Removing $(INSTALL_DIR)..."
	rm -rf $(INSTALL_DIR)
	@echo "[uninstall] Verifying..."
	@if [ ! -e $(SYSTEMD_DIR)/$(SERVICE_NAME) ] && [ ! -e $(INSTALL_DIR) ]; then \
		echo "[uninstall] ✓ Service unit and application removed."; \
	else \
		echo "[uninstall] ✗ Cleanup verification failed."; \
		exit 1; \
	fi
	@echo "[uninstall] ✓ Data preserved at $(DATA_DIR)."

purge: uninstall
	@test "$$(id -u)" = "0" || (echo "Run 'make purge' as root (use sudo)." && exit 1)
	@echo "[purge] Removing $(DATA_DIR)..."
	rm -rf $(DATA_DIR)
	@echo "[purge] Verifying..."
	@if [ ! -e $(DATA_DIR) ]; then \
		echo "[purge] ✓ Data and application state removed."; \
	else \
		echo "[purge] ✗ Cleanup verification failed."; \
		exit 1; \
	fi
	@echo "[purge] ✓ $(APP_NAME) is fully purged."

test:
	bun test

typecheck:
	bun run typecheck

build:
	bun run build

release:
	@test -n "$(VERSION)" || (echo "Usage: make release VERSION=0.1.0" && exit 1)
	@printf '%s\n' "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$$' || (echo "Invalid SemVer: $(VERSION)" && exit 1)
	@test "$$(git branch --show-current)" = "main" || (echo "Release must be created from the main branch." && exit 1)
	@test -z "$$(git status --porcelain)" || (echo "Git working tree must be clean before release." && exit 1)
	@test -z "$$(git tag --list v$(VERSION))" || (echo "Git tag v$(VERSION) already exists." && exit 1)
	@echo "[release] Validating source..."
	@$(MAKE) typecheck
	@$(MAKE) test
	@git diff --check
	@echo "[release] Updating package.json to $(VERSION)..."
	@RELEASE_VERSION="$(VERSION)" bun -e 'const p=JSON.parse(await Bun.file("package.json").text()); p.version=process.env.RELEASE_VERSION; await Bun.write("package.json", JSON.stringify(p,null,2)+"\n");'
	@git diff --check
	@git add package.json
	@if ! git diff --cached --quiet; then git commit -m "chore: release v$(VERSION)"; else echo "[release] package.json already at $(VERSION), skipping release commit."; fi
	@git tag -a "v$(VERSION)" -m "Release v$(VERSION)"
	@git push origin main "v$(VERSION)"
	@echo "[release] ✓ v$(VERSION) released and pushed."
