import { getToolCatalog, type ToolCatalogEntry } from "../../control-plane/tools/registry";

export type DashboardTool = ToolCatalogEntry;

export async function getDashboardTools(): Promise<DashboardTool[]> {
  return getToolCatalog();
}
