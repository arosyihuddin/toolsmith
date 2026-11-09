import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "../db";
import { toolCallLogs, type NewToolCallLog, type ToolCallLog } from "../db/schema";
import { emitDashboardEvent } from "../../modules/dashboard/events";

export type ToolCallLogInput = Omit<NewToolCallLog, "id">;

export function recordToolCallLog(input: ToolCallLogInput): ToolCallLog {
  const row = {
    ...input,
    id: crypto.randomUUID(),
  };
  db.insert(toolCallLogs).values(row).run();
  const saved = db.select().from(toolCallLogs).where(eq(toolCallLogs.id, row.id)).get()!;
  emitDashboardEvent({ type: "tool_call.created", data: saved });
  return saved;
}

export function updateToolCallLog(id: string, patch: Partial<Omit<ToolCallLogInput, "timestamp" | "requestId" | "sessionId" | "toolName">>): ToolCallLog | undefined {
  db.update(toolCallLogs).set(patch).where(eq(toolCallLogs.id, id)).run();
  const saved = db.select().from(toolCallLogs).where(eq(toolCallLogs.id, id)).get();
  if (saved) emitDashboardEvent({ type: "tool_call.updated", data: saved });
  return saved;
}

export function listToolCallLogs(limit = 100): ToolCallLog[] {
  return db.select().from(toolCallLogs).orderBy(desc(toolCallLogs.timestamp)).limit(Math.min(Math.max(Math.trunc(limit), 1), 100_000)).all();
}


/** Count persisted tool calls for the current calendar day in Jakarta time (WIB). */
export function countToolCallsToday(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  // Jakarta uses UTC+07:00 year-round. Convert local midnight to UTC for ISO timestamp comparisons.
  const start = new Date(Date.UTC(part("year"), part("month") - 1, part("day")) - 7 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const result = db.select({ total: count() }).from(toolCallLogs).where(
    and(gte(toolCallLogs.timestamp, start.toISOString()), lt(toolCallLogs.timestamp, end.toISOString())),
  ).get();
  return result?.total ?? 0;
}
