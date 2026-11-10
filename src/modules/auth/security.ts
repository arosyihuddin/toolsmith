import { resolvePublicOrigin } from "./public-origin";
/** Security helpers for browser-based administrator authentication. */
export function requestOrigin(request: Request, fallback = process.env.MCP_PUBLIC_URL): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim() ?? "";
  const isLoopbackHost = host === "localhost" || host.startsWith("127.") || host === "[::1]";
  if (!forwardedHost && isLoopbackHost && fallback) {
    try {
      const configuredOrigin = new URL(fallback);
      if (configuredOrigin.protocol === "https:") return configuredOrigin.origin;
    } catch {}
  }
  const publicOrigin = resolvePublicOrigin(request, fallback);
  if (publicOrigin) return publicOrigin.origin;

  const originHost = forwardedHost || host;
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
    const fallbackUrl = new URL(request.url);
    const origin = new URL(fallbackUrl.origin);
    if (originHost) {
      origin.port = "";
      origin.host = originHost;
    }
    if (protocol === "https" || protocol === "http") origin.protocol = protocol + ":";
    return origin.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request, fallback = process.env.MCP_PUBLIC_URL): boolean {
  const supplied = request.headers.get("origin") ?? request.headers.get("referer");
  if (!supplied) return false;
  try {
    const suppliedOrigin = new URL(supplied).origin;
    const acceptedOrigins = new Set([requestOrigin(request, fallback)]);

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
