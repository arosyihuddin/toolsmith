import { getDashboardTools } from "./tools";
import { setToolExposed } from "../../control-plane/tools/exposure";
import { permissionModes, customRules, setSectionPermission, setToolPermission, resetSectionToolOverrides, getSectionPermissions, getSectionCustomRules, type PermissionMode, type PermissionSection } from "../../control-plane/tools/permissions";
import { isCustomPermissionRule, normalizeCustomPermissionRule } from "../../control-plane/tools/custom-rules";
import { validateCustomRuleFields } from "../../control-plane/tools/input-schema";

export async function handleToolsApi(request: Request, url: URL): Promise<Response | null> {
  const sectionPermissionMatch = url.pathname.match(
    /^\/api\/tools\/sections\/(read_only|edit_delete|other)\/permission$/,
  );
  if (sectionPermissionMatch && request.method === "PATCH") {
    try {
      const section = sectionPermissionMatch[1] as PermissionSection;
      const body = (await request.json()) as {
        permission?: unknown;
        customRule?: unknown;
      };
      if (!permissionModes.includes(body.permission as PermissionMode))
        throw new Error("Invalid permission mode");
      if (
        body.customRule !== undefined &&
        !(
          isCustomPermissionRule(body.customRule) ||
          (typeof body.customRule === "string" &&
            customRules.includes(body.customRule))
        )
      )
        throw new Error("Invalid custom permission rule");
      const tools = await getDashboardTools();
      if (body.customRule !== undefined) {
        const fieldError = validateCustomRuleFields(
          normalizeCustomPermissionRule(body.customRule),
          tools
            .filter((tool) => tool.section === section)
            .map((tool) => tool.name),
        );
        if (fieldError) throw new Error(fieldError);
      }
      setSectionPermission(
        section,
        body.permission as PermissionMode,
        body.customRule === undefined
          ? undefined
          : normalizeCustomPermissionRule(body.customRule),
      );
      resetSectionToolOverrides(section, tools);
      return Response.json(
        {
          tools: await getDashboardTools(),
          sectionPermissions: getSectionPermissions(),
          sectionCustomRules: getSectionCustomRules(),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to update section permission",
        },
        { status: 400 },
      );
    }
  }

  const toolMatch = url.pathname.match(/^\/api\/tools\/(.+)$/);
  if (toolMatch && request.method === "PATCH") {
    try {
      const name = decodeURIComponent(toolMatch[1]);
      const currentTools = await getDashboardTools();
      if (!currentTools.some((item) => item.name === name))
        return Response.json({ error: "Unknown tool" }, { status: 404 });
      const body = (await request.json()) as {
        exposed?: unknown;
        permission?: unknown;
        customRule?: unknown;
      };
      if (body.exposed !== undefined) {
        if (typeof body.exposed !== "boolean")
          throw new Error("exposed must be a boolean");
        setToolExposed(name, body.exposed);
      }
      if (body.permission !== undefined || body.customRule !== undefined) {
        if (
          body.permission !== undefined &&
          body.permission !== null &&
          !permissionModes.includes(body.permission as PermissionMode)
        )
          throw new Error("Invalid permission mode");
        if (
          body.customRule !== undefined &&
          !(
            isCustomPermissionRule(body.customRule) ||
            (typeof body.customRule === "string" &&
              customRules.includes(body.customRule))
          )
        )
          throw new Error("Invalid custom permission rule");
        if (body.customRule !== undefined) {
          const fieldError = validateCustomRuleFields(
            normalizeCustomPermissionRule(body.customRule),
            [name],
          );
          if (fieldError) throw new Error(fieldError);
        }
        setToolPermission(
          name,
          body.permission as PermissionMode | null,
          body.customRule === undefined
            ? undefined
            : normalizeCustomPermissionRule(body.customRule),
        );
      }
      if (
        body.exposed === undefined &&
        body.permission === undefined &&
        body.customRule === undefined
      )
        throw new Error("No tool setting provided");
      const tool = (await getDashboardTools()).find(
        (item) => item.name === name,
      );
      return Response.json(
        { tool },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to update tool settings",
        },
        { status: 400 },
      );
    }
  }
  if (url.pathname === "/api/tools" && request.method === "GET") {
    return Response.json(
      { tools: await getDashboardTools() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return null;
}
