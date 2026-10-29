import { asc } from "drizzle-orm";
import { db } from "../db";
import { toolConfigs } from "../db/schema";
import {
  getToolPermission,
  type CustomPermissionRule,
  type PermissionMode,
  type PermissionSection,
} from "./permissions";
import {
  getToolInputFields,
  registerToolInputSchema,
  type InputField,
} from "./input-schema";

export type ToolRisk = "low" | "medium" | "high" | "isolated";
export type ToolCategory =
  | "system_diagnostics"
  | "desktop_automation"
  | "files_search"
  | "code_development"
  | "terminal_execution"
  | "network_tunnels"
  | "agent_workflow";

export type ToolCatalogEntry = {
  name: string;
  group: string;
  category: ToolCategory;
  risk: ToolRisk;
  description: string;
  exposed: boolean;
  section: PermissionSection;
  permission: PermissionMode;
  permissionOverride: PermissionMode | null;
  sectionPermission: PermissionMode;
  customRule: CustomPermissionRule;
  inputFields: InputField[];
  sectionCustomRule: CustomPermissionRule;
};

const staticTools: Omit<
  ToolCatalogEntry,
  | "category"
  | "exposed"
  | "section"
  | "permission"
  | "permissionOverride"
  | "sectionPermission"
  | "customRule"
  | "sectionCustomRule"
  | "inputFields"
>[] = [
  ["read", "Toolsmith", "low", "Read UTF-8 text files within the configured workspace."],
  ["write", "Toolsmith", "high", "Write UTF-8 text files within the configured workspace."],
  ["edit", "Toolsmith", "high", "Replace a unique text match in a workspace file."],
  ["bash", "Toolsmith", "high", "Run a shell command in the configured workspace, subject to permissions and approval."],
  ["find", "Toolsmith", "low", "Find files and directories within the configured workspace."],
  ["grep", "Toolsmith", "low", "Search file contents within the configured workspace."],
  [
    "system_info",
    "System",
    "low",
    "Get a structured snapshot of the host OS, CPU, memory, GPU, disk, desktop session, display, runtimes, and network interfaces. Read-only.",
  ],
  [
    "hardware_info",
    "System",
    "low",
    "Get CPU, memory, GPU, and root filesystem information. Read-only.",
  ],
  [
    "capabilities",
    "System",
    "low",
    "Detect host capabilities relevant to computer automation, including GUI session, display server, accessibility bus, NVIDIA GPU, and installed runtimes. Read-only.",
  ],
  [
    "fs_find",
    "Filesystem",
    "low",
    "Search files and directories by pattern. Uses fd when available and a built-in fallback otherwise; read-only.",
  ],
  [
    "fs_grep",
    "Filesystem",
    "low",
    "Fast recursive content search using ripgrep. Suitable for large directory trees; read-only.",
  ],
  [
    "window_list",
    "Computer",
    "low",
    "List currently open desktop windows and their workspace, monitor, application, and focus state.",
  ],
  [
    "window_active",
    "Computer",
    "low",
    "Get the desktop window that currently has keyboard focus.",
  ],
  [
    "window_focus",
    "Computer",
    "medium",
    "Focus a desktop window by its window id.",
  ],
  [
    "window_close",
    "Computer",
    "medium",
    "Close a desktop window by its window id.",
  ],
  [
    "window_move",
    "Computer",
    "medium",
    "Move a desktop window to a workspace by its window id.",
  ],
  [
    "app_list",
    "Computer",
    "low",
    "List desktop applications available on the operating system. Supports optional search and result limit.",
  ],
  [
    "mouse_move",
    "Computer",
    "medium",
    "Move the mouse pointer to absolute screen coordinates.",
  ],
  [
    "mouse_click",
    "Computer",
    "high",
    "Click the mouse at the current cursor position. Defaults to left click.",
  ],
  [
    "mouse_drag",
    "Computer",
    "high",
    "Drag the left mouse button from one screen coordinate to another.",
  ],
  ["mouse_scroll", "Computer", "medium", "Scroll the mouse wheel."],
  [
    "keyboard_press",
    "Computer",
    "high",
    "Press and release a keyboard key, or a key combination such as Ctrl+C.",
  ],
  [
    "keyboard_hotkey",
    "Computer",
    "high",
    "Press a keyboard shortcut using the supplied modifier/key sequence.",
  ],
  [
    "keyboard_type",
    "Computer",
    "high",
    "Type literal text into the currently focused application.",
  ],
  [
    "screenshot",
    "Computer",
    "low",
    "Capture the current desktop screen as a PNG. Requires an interactive GUI session.",
  ],
  [
    "tunnel_list",
    "Cloudflare Tunnel",
    "low",
    "List Cloudflare Quick Tunnels managed by Toolsmith, including state, target URL, public URL, and recent logs.",
  ],
  [
    "tunnel_status",
    "Cloudflare Tunnel",
    "low",
    "Get the current state and recent logs for a managed Cloudflare Quick Tunnel.",
  ],
  [
    "tunnel_start",
    "Cloudflare Tunnel",
    "high",
    "Start a Cloudflare Quick Tunnel to a local HTTP(S) service. Target must use localhost, 127.0.0.1, or ::1. Requires cloudflared installed on the Toolsmith host.",
  ],
  [
    "tunnel_stop",
    "Cloudflare Tunnel",
    "high",
    "Stop a managed Cloudflare Quick Tunnel by its ID.",
  ],
  [
    "sudo_exec",
    "Root Command",
    "high",
    "Execute a root command directly. Exact matches to enabled root-command rules bypass approval; other commands follow the Toolsmith permission policy and required approval, without shell parsing.",
  ],
  ["glob", "Files", "low", "Find workspace files matching a glob pattern."],
  ["eval", "Execution", "high", "Execute JavaScript or Python code in a child process."],
  ["context_notes", "Agent Workflow", "medium", "Read and update context notes scoped to the current session."],
  ["wait", "Agent Workflow", "low", "Wait for a bounded duration."],
  ["todo", "Agent Workflow", "medium", "Manage a session-scoped task list."],
  ["ast_grep", "Code Development", "low", "Search code using structural AST patterns."],
  ["ast_edit", "Code Development", "high", "Apply AST-based code rewrites."],
  ["github", "GitHub", "low", "Use GitHub CLI for repository, issue, pull request, and workflow queries."],
].map(([name, group, risk, description]) => ({
  name,
  group,
  risk: risk as ToolRisk,
  description,
}));

function categoryForTool(name: string): ToolCategory {
  if (["system_info", "hardware_info", "capabilities"].includes(name))
    return "system_diagnostics";
  if (/^(window_|app_list|mouse_|keyboard_|screenshot$)/.test(name))
    return "desktop_automation";
  if (["fs_find", "fs_grep", "read", "glob", "grep", "find"].includes(name))
    return "files_search";
  if (["edit", "write", "ast_grep", "ast_edit", "lsp", "debug"].includes(name))
    return "code_development";
  if (["bash", "eval"].includes(name)) return "terminal_execution";
  if (name.startsWith("tunnel_")) return "network_tunnels";
  if (name === "sudo_exec") return "terminal_execution";
  return "agent_workflow";
}

function now() {
  return new Date().toISOString();
}

function ensureToolConfig(name: string) {
  const timestamp = now();
  db.insert(toolConfigs)
    .values({
      toolName: name,
      exposed: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing({ target: toolConfigs.toolName })
    .run();
}

export async function getToolCatalog(): Promise<ToolCatalogEntry[]> {
  const catalog = new Map<
    string,
    Omit<
      ToolCatalogEntry,
      | "exposed"
      | "section"
      | "permission"
      | "permissionOverride"
      | "sectionPermission"
      | "customRule"
      | "sectionCustomRule"
      | "inputFields"
    >
  >();
  for (const tool of staticTools)
    catalog.set(tool.name, { ...tool, category: categoryForTool(tool.name) });
  const tools = [...catalog.values()];

  for (const tool of tools) ensureToolConfig(tool.name);

  const rows = db.select().from(toolConfigs).all();
  const exposure = new Map(rows.map((row) => [row.toolName, row.exposed]));

  return tools.map((tool) => ({
    ...tool,
    inputFields: getToolInputFields(tool.name),
    exposed: exposure.get(tool.name) ?? true,
    ...getToolPermission(tool.name, tool.risk),
  }));
}

export function listToolConfigs() {
  return db
    .select()
    .from(toolConfigs)
    .orderBy(asc(toolConfigs.toolName))
    .all()
    .map((row) => ({
      toolName: row.toolName,
      exposed: row.exposed,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

export { ensureToolConfig, isToolExposed, setToolExposed } from "./exposure";
export {
  getSectionPermissions,
  getSectionCustomRules,
  permissionModes,
  customRules,
  setSectionPermission,
  setToolPermission,
  type CustomPermissionRule,
  type PermissionMode,
  type PermissionSection,
} from "./permissions";
