import { approveApproval, clearApprovalHistory, denyApproval, listApprovals } from "../approval";

export async function handleApprovalsApi(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/approvals") {
    return Response.json(
      { approvals: listApprovals() },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (url.pathname === "/api/approvals/clear" && request.method === "POST") {
    clearApprovalHistory();
    return Response.json(
      { approvals: listApprovals() },
      { headers: { "cache-control": "no-store" } },
    );
  }
  if (url.pathname.startsWith("/api/approvals/") && request.method === "POST") {
    const parts = url.pathname.split("/");
    const id = parts[3];
    const action = parts[4];
    if (!id || !["approve", "deny"].includes(action)) {
      return Response.json(
        { error: "Invalid approval action" },
        { status: 400 },
      );
    }
    const changed =
      action === "approve" ? approveApproval(id) : denyApproval(id);
    if (!changed)
      return Response.json(
        { error: "Approval not found or no longer pending" },
        { status: 404 },
      );
    return Response.json(
      { approval: listApprovals().find((item) => item.id === id) },
      { headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}
