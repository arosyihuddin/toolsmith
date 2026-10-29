import { timingSafeEqual } from "node:crypto";
import { verifyOAuthAccessToken } from "./oauth";

const token = (process.env.TOOLSMITH_API_TOKEN ?? process.env.OMP_API_TOKEN)?.trim() ?? "";

/** Protect HTTP endpoints with the internal Bearer token; MCP also accepts OAuth access tokens. */
export async function authorizeHttpRequest(request: Request, allowOAuth = false): Promise<Response | null> {
  const resourcePath = process.env.MCP_HTTP_PATH ?? "/mcp";
  const publicUrl = process.env.MCP_PUBLIC_URL?.trim();
  const metadataUrl = publicUrl ? new URL("/.well-known/oauth-protected-resource" + resourcePath, publicUrl).href : "";
  const headers = { "cache-control": "no-store", "www-authenticate": metadataUrl ? 'Bearer resource_metadata="' + metadataUrl + '"' : "Bearer" };
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const supplied = match?.[1]?.trim() ?? "";
  if (allowOAuth && supplied) {
    const verified = await verifyOAuthAccessToken(supplied);
    if (verified && verified.scopes.includes("mcp:tools")) return null;
  }
  if (!token && allowOAuth) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!token) return Response.json({ error: "HTTP API is disabled: TOOLSMITH_API_TOKEN is not configured (legacy OMP_API_TOKEN is also accepted)." }, { status: 503, headers });
  if (!supplied) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  const expectedBytes = Buffer.from(token), suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  return null;
}
