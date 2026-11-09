/**
 * Resolve the public HTTPS origin for requests arriving through a local
 * reverse proxy. The HTTP server must remain bound to loopback; these
 * forwarded headers are only trusted at that local proxy boundary.
 */
export function resolvePublicOrigin(
  request?: Request,
  fallback = process.env.MCP_PUBLIC_URL,
): URL | null {
  const forwardedHost = request?.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request?.headers.get("host")?.trim();
  const forwardedProto = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  let proxyProto = forwardedProto;

  if (!proxyProto) {
    const cfVisitor = request?.headers.get("cf-visitor");
    if (cfVisitor) {
      try {
        const scheme = JSON.parse(cfVisitor).scheme;
        if (typeof scheme === "string") proxyProto = scheme.toLowerCase();
      } catch {}
    }
  }

  if (!proxyProto && request && new URL(request.url).protocol === "https:") {
    proxyProto = "https";
  }

  if (host && proxyProto === "https") {
    try {
      const candidate = new URL("https://" + host);
      if (
        !candidate.hostname ||
        candidate.username ||
        candidate.password ||
        candidate.pathname !== "/" ||
        candidate.search ||
        candidate.hash
      ) {
        throw new Error("Invalid forwarded host");
      }
      return candidate;
    } catch {
      // Ignore malformed proxy headers and use the explicit fallback.
    }
  }

  if (!fallback?.trim()) return null;
  try {
    const candidate = new URL(fallback.trim());
    if (
      candidate.protocol !== "https:" ||
      !candidate.hostname ||
      candidate.username ||
      candidate.password ||
      candidate.pathname !== "/" ||
      candidate.search ||
      candidate.hash
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}
