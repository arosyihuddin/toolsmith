import { emitDashboardEvent } from "../dashboard/events";

export type ApprovalRisk = "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "cancelled";

export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: ApprovalRisk;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  requestId: string | number;
  reason?: string;
}

type ApprovalDecision = {
  approved: boolean;
  status: ApprovalStatus;
};

type PendingApproval = ApprovalRequest & {
  resolve: (decision: ApprovalDecision) => void;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const approvals = new Map<string, PendingApproval>();

function now() {
  return new Date().toISOString();
}

function publicApproval({ resolve: _resolve, ...approval }: PendingApproval): ApprovalRequest {
  return approval;
}

function finish(id: string, status: ApprovalStatus, approved: boolean) {
  const pending = approvals.get(id);
  if (!pending || pending.status !== "pending") return false;
  pending.status = status;
  pending.updatedAt = now();
  pending.resolve({ approved, status });
  emitDashboardEvent({ type: "approval.updated", data: publicApproval(pending) });
  return true;
}



export function clearApprovalHistory() {
  for (const [id, approval] of approvals) {
    if (approval.status !== "pending") approvals.delete(id);
  }
  emitDashboardEvent({ type: "approval.cleared" });
}


export function listApprovals(): ApprovalRequest[] {
  return [...approvals.values()]
    .map(publicApproval)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getApproval(id: string): ApprovalRequest | undefined {
  const approval = approvals.get(id);
  return approval ? publicApproval(approval) : undefined;
}

export function approveApproval(id: string) {
  return finish(id, "approved", true);
}

export function denyApproval(id: string) {
  return finish(id, "denied", false);
}

export function getApprovalDecisionMessage(status: ApprovalStatus) {
  switch (status) {
    case "denied": return "Approval denied by user.";
    case "expired": return "Approval expired.";
    case "cancelled": return "Approval cancelled.";
    default: return "Operation was not approved.";
  }
}

export async function requestApproval(options: {
  tool: string;
  args: Record<string, unknown>;
  risk: ApprovalRisk;
  sessionId?: string;
  requestId: string | number;
  signal?: AbortSignal;
  reason?: string;
  ttlMs?: number;
}): Promise<ApprovalDecision> {

  const id = crypto.randomUUID();
  const createdAt = now();
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  return new Promise<ApprovalDecision>((resolve) => {
    const pending: PendingApproval = {
      id,
      tool: options.tool,
      args: options.args,
      risk: options.risk,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      sessionId: options.sessionId,
      requestId: options.requestId,
      reason: options.reason,
      resolve,
    };
    approvals.set(id, pending);
    emitDashboardEvent({ type: "approval.created", data: publicApproval(pending) });

    const timer = setTimeout(() => {
      finish(id, "expired", false);
    }, ttlMs);

    const onAbort = () => {
      clearTimeout(timer);
      finish(id, "cancelled", false);
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });

    const originalResolve = pending.resolve;
    pending.resolve = (decision) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      originalResolve(decision);
    };
  });
}
