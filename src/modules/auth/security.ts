/** Security helpers for browser-based administrator authentication. */
export function requestOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  let protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();

  if (!protocol) {
    try {
      const visitor = request.headers.get("cf-visitor");
      if (visitor) {
        const scheme = JSON.parse(visitor).scheme;
        if (typeof scheme === "string") protocol = scheme.toLowerCase();
      }
    } catch {}
  }

  try {
    const fallback = new URL(request.url);
    const origin = new URL(fallback.origin);
    if (host) {
      origin.port = "";
      origin.host = host;
    }
    if (protocol === "https" || protocol === "http") origin.protocol = protocol + ":";
    return origin.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const supplied = request.headers.get("origin") ?? request.headers.get("referer");
  if (!supplied) return false;
  try {
    const suppliedOrigin = new URL(supplied).origin;
    const acceptedOrigins = new Set([requestOrigin(request)]);

    // A direct client (for example, a Tailscale IP) may bypass the reverse
    // proxy while stale forwarded headers are still present on the request.
    // Keep the actual Host/request URL origin valid alongside the proxy origin.
    const directOrigin = new URL(request.url);
    const host = request.headers.get("host")?.trim();
    if (host) directOrigin.host = host;
    acceptedOrigins.add(directOrigin.origin);

    return acceptedOrigins.has(suppliedOrigin);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request): boolean {
  if (request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https") return true;
  try {
    const visitor = request.headers.get("cf-visitor");
    if (visitor && JSON.parse(visitor).scheme === "https") return true;
  } catch {}
  return new URL(request.url).protocol === "https:";
}

export function readCookie(request: Request, name: string): string {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}
