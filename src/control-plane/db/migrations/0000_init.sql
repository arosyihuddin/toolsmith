CREATE TABLE IF NOT EXISTS `editor_sessions` (
	`root` text PRIMARY KEY NOT NULL,
	`tabs` text NOT NULL,
	`active_path` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`grant_types` text NOT NULL,
	`response_types` text NOT NULL,
	`token_endpoint_auth_method` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`state` text,
	`scopes` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`token_type` text NOT NULL,
	`scopes` text NOT NULL,
	`resource` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'User' NOT NULL,
	`avatar_color` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` text NOT NULL,
	`request_id` text,
	`session_id` text,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`approval` text,
	`duration_ms` integer,
	`arguments` text,
	`error` text,
	`result` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_call_logs_timestamp` ON `tool_call_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_call_logs_tool_name` ON `tool_call_logs` (`tool_name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_call_logs_session_id` ON `tool_call_logs` (`session_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_configs` (
	`tool_name` text PRIMARY KEY NOT NULL,
	`exposed` integer DEFAULT true NOT NULL,
	`permission_override` text,
	`custom_rule` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_configs_updated_at` ON `tool_configs` (`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_permission_groups` (
	`section` text PRIMARY KEY NOT NULL,
	`permission` text NOT NULL,
	`custom_rule` text DEFAULT 'approval' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `tool_permission_groups` (`section`, `permission`, `custom_rule`, `updated_at`) VALUES
  ('read_only', 'always_allow', 'approval', CURRENT_TIMESTAMP),
  ('edit_delete', 'require_approval', 'approval', CURRENT_TIMESTAMP),
  ('other', 'require_approval', 'approval', CURRENT_TIMESTAMP)
ON CONFLICT(`section`) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_favorites` (
	`path` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_pins` (
	`path` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_prefs` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workspace_recents` (
	`path` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`opened_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_workspace_recents_opened_at` ON `workspace_recents` (`opened_at`);