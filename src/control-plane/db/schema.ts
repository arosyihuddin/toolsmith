import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const toolConfigs = sqliteTable(
  "tool_configs",
  {
    toolName: text("tool_name").primaryKey(),
    exposed: integer("exposed", { mode: "boolean" }).notNull().default(true),
    permissionOverride: text("permission_override"),
    customRule: text("custom_rule"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_tool_configs_updated_at").on(table.updatedAt)],
);

export const toolCallLogs = sqliteTable(
  "tool_call_logs",
  {
    id: text("id").primaryKey(),
    timestamp: text("timestamp").notNull(),
    requestId: text("request_id"),
    sessionId: text("session_id"),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    approval: text("approval"),
    durationMs: integer("duration_ms"),
    arguments: text("arguments"),
    error: text("error"),
    result: text("result"),
  },
  (table) => [
    index("idx_tool_call_logs_timestamp").on(table.timestamp),
    index("idx_tool_call_logs_tool_name").on(table.toolName),
    index("idx_tool_call_logs_session_id").on(table.sessionId),
  ],
);

export const profile = sqliteTable("profile", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull().default("User"),
  avatarColor: text("avatar_color"),
  updatedAt: text("updated_at").notNull(),
});

export const workspacePins = sqliteTable("workspace_pins", {
  path: text("path").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const workspaceFavorites = sqliteTable("workspace_favorites", {
  path: text("path").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  createdAt: text("created_at").notNull(),
});

export const workspaceRecents = sqliteTable(
  "workspace_recents",
  {
    path: text("path").primaryKey(),
    name: text("name").notNull(),
    openedAt: text("opened_at").notNull(),
  },
  (table) => [index("idx_workspace_recents_opened_at").on(table.openedAt)],
);

export const workspacePrefs = sqliteTable("workspace_prefs", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const editorSessions = sqliteTable("editor_sessions", {
  root: text("root").primaryKey(),
  tabs: text("tabs").notNull(),
  activePath: text("active_path"),
  updatedAt: text("updated_at").notNull(),
});

export type ToolConfig = typeof toolConfigs.$inferSelect;
export type NewToolConfig = typeof toolConfigs.$inferInsert;
export type ToolCallLog = typeof toolCallLogs.$inferSelect;
export type NewToolCallLog = typeof toolCallLogs.$inferInsert;
export const toolPermissionGroups = sqliteTable("tool_permission_groups", {
  section: text("section").primaryKey(),
  permission: text("permission").notNull(),
  customRule: text("custom_rule").notNull().default("approval"),
  updatedAt: text("updated_at").notNull(),
});
export const oauthClients = sqliteTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").notNull(),
  grantTypes: text("grant_types").notNull(),
  responseTypes: text("response_types").notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const oauthCodes = sqliteTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state"),
  scopes: text("scopes").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  tokenType: text("token_type").notNull(),
  scopes: text("scopes").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});
