/** Keep an existing public origin when setup does not explicitly replace it. */
export function preservePublicUrl(submitted: string, existing: unknown): string {
  const next = submitted.trim();
  if (next) return next;
  return typeof existing === "string" ? existing.trim() : "";
}
