import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { sqlite } from "../../control-plane/db";
import { logger } from "../../lib/logger";
import { isSameOriginRequest, isSecureRequest, readCookie, requestOrigin } from "./security";
import { resolvePublicOrigin } from "./public-origin";
import { preservePublicUrl } from "./oauth-config";
import { configFilePath } from "../../lib/config";

const configFile = configFilePath;
function oauthConfig(request?: Request) {
  const issuer = resolvePublicOrigin(request);
  const resourceUrl = issuer ? new URL(process.env.MCP_HTTP_PATH ?? "/mcp", issuer) : null;
  return { issuer, resourceUrl };
}
const scopes = ["mcp:tools"];
const now = () => Math.floor(Date.now() / 1000);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
const securityHeaders = { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "permissions-policy": "camera=(), microphone=(), geolocation=()" };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { ...securityHeaders, "cache-control": "no-store", pragma: "no-cache", ...headers } });
function oauthEnabled(request?: Request) { const { issuer, resourceUrl } = oauthConfig(request); return Boolean(issuer && issuer.protocol === "https:" && issuer.pathname === "/" && !issuer.search && !issuer.hash && resourceUrl); }

sqlite.exec(`CREATE TABLE IF NOT EXISTS toolsmith_admin (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS toolsmith_admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS toolsmith_admin_login_attempts (subject_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, window_started_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS oauth_authorize_csrf (token_hash TEXT PRIMARY KEY, request_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
const sessionCookie = "toolsmith_session";
function adminConfigured() { return Boolean(sqlite.query("SELECT id FROM toolsmith_admin WHERE id = 1").get()); }
function passwordHash(password: string, salt: Buffer) { return scryptSync(password, salt, 64).toString("hex"); }
function verifyAdmin(user: string, pass: string) {
  const row = sqlite.query("SELECT username, salt, password_hash FROM toolsmith_admin WHERE id = 1").get() as any;
  if (!row) return false;
  const salt = Buffer.from(row.salt, "hex");
  const candidate = passwordHash(pass, salt);
  return safeEqual(user, row.username) && safeEqual(candidate, row.password_hash);
}
function sessionToken(request: Request) { return readCookie(request, sessionCookie); }
function hasSession(request: Request) { const token = sessionToken(request); if (!token) return false; sqlite.query("DELETE FROM toolsmith_admin_sessions WHERE expires_at <= ?").run(now()); return Boolean(sqlite.query("SELECT token_hash FROM toolsmith_admin_sessions WHERE token_hash = ? AND expires_at > ?").get(hash(token), now())); }
function cookie(token: string, maxAge: number, request: Request) { return sessionCookie + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (isSecureRequest(request) ? "; Secure" : ""); }
const csrfCookie = "toolsmith_csrf";
function csrfCookieValue(token: string, request: Request) { return csrfCookie + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600" + (isSecureRequest(request) ? "; Secure" : ""); }
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 5;
function loginSubject(request: Request, username: string) {
  const ip = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  return hash(username.trim().toLowerCase() + "|" + ip);
}
function isLoginBlocked(request: Request, username: string): boolean {
  const subject = loginSubject(request, username), timestamp = now();
  sqlite.query("DELETE FROM toolsmith_admin_login_attempts WHERE window_started_at <= ? AND blocked_until <= ?").run(timestamp - LOGIN_WINDOW_SECONDS, timestamp);
  const row = sqlite.query("SELECT attempts, window_started_at, blocked_until FROM toolsmith_admin_login_attempts WHERE subject_hash = ?").get(subject) as { attempts: number; window_started_at: number; blocked_until: number } | null;
  if (!row) return false;
  if (row.blocked_until > timestamp) return true;
  if (timestamp - row.window_started_at >= LOGIN_WINDOW_SECONDS) {
    sqlite.query("DELETE FROM toolsmith_admin_login_attempts WHERE subject_hash = ?").run(subject);
    return false;
  }
  return false;
}
function recordLoginFailure(request: Request, username: string) {
  const subject = loginSubject(request, username), timestamp = now();
  const row = sqlite.query("SELECT attempts, window_started_at FROM toolsmith_admin_login_attempts WHERE subject_hash = ?").get(subject) as { attempts: number; window_started_at: number } | null;
  const attempts = row && timestamp - row.window_started_at < LOGIN_WINDOW_SECONDS ? row.attempts + 1 : 1;
  const started = row && timestamp - row.window_started_at < LOGIN_WINDOW_SECONDS ? row.window_started_at : timestamp;
  const blockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? timestamp + LOGIN_WINDOW_SECONDS : 0;
  sqlite.query("INSERT INTO toolsmith_admin_login_attempts (subject_hash, attempts, window_started_at, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(subject_hash) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until").run(subject, attempts, started, blockedUntil);
}
function clearLoginFailures(request: Request, username: string) {
  sqlite.query("DELETE FROM toolsmith_admin_login_attempts WHERE subject_hash = ?").run(loginSubject(request, username));
}
async function writeSecrets(apiToken: string, sudoKey: string, username: string, publicUrl: string) { await mkdir(join(configFile, ".."), { recursive: true, mode: 0o700 }); const raw = existsSync(configFile) ? await readFile(configFile, "utf8") : "server:\n  host: 127.0.0.1\n  port: 48766\n  path: /mcp\n  transport: http\n"; const cfg = (parse(raw) ?? {}) as any; cfg.security = { ...(cfg.security ?? {}), api_token: apiToken, sudo_encryption_key: sudoKey }; delete cfg.security.setup_token; const preservedPublicUrl = preservePublicUrl(publicUrl, cfg.oauth?.public_url); cfg.oauth = { ...(cfg.oauth ?? {}), username, password: "", public_url: preservedPublicUrl }; const tmp = configFile + ".tmp"; await writeFile(tmp, stringify(cfg), { mode: 0o600 }); await chmod(tmp, 0o600); await writeFile(configFile, await readFile(tmp)); await chmod(configFile, 0o600); await Bun.file(tmp).delete(); process.env.TOOLSMITH_API_TOKEN = apiToken; process.env.TOOLSMITH_SUDO_ENCRYPTION_KEY = sudoKey; process.env.TOOLSMITH_OAUTH_USERNAME = username; process.env.TOOLSMITH_OAUTH_PASSWORD = ""; if (preservedPublicUrl) process.env.MCP_PUBLIC_URL = preservedPublicUrl; }

const wantsJson = (request: Request) => request.headers.get("accept")?.includes("application/json") ?? false;

async function uiShell(status = 200, oauthCsrfToken?: string): Promise<Response> {
  const file = Bun.file(join(process.cwd(), "dist", "ui", "200.html"));
  if (!(await file.exists())) return new Response("Toolsmith UI is not built. Run the production build first.", { status: 503, headers: { ...securityHeaders, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  let html = await file.text();
  if (oauthCsrfToken) html = html.replace("</head>", `<meta name="toolsmith-oauth-csrf" content="${oauthCsrfToken}"></head>`);
  const headers: Record<string, string> = { ...securityHeaders, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  return new Response(html, { status, headers });
}

const oauthAuthorizeCsrfLifetime = 300;
function oauthAuthorizeRequestHash(params: URLSearchParams) {
  return hash(JSON.stringify(["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "resource", "state", "scope"].map((key) => params.get(key))));
}

async function uiAsset(path: string): Promise<Response> {
  const root = resolve(process.cwd(), "dist", "ui");
  const target = resolve(root, path.replace(/^\//, ""));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel.includes(".." + sep)) return new Response("Not found", { status: 404 });
  const file = Bun.file(target);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const extension = target.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", png: "image/png", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2" };
  return new Response(file, { headers: { ...securityHeaders, "content-type": contentTypes[extension] ?? "application/octet-stream", "cache-control": path.startsWith("/_app/") ? "public, max-age=31536000, immutable" : "public, max-age=3600" } });
}

async function adminRequest(request: Request, path: string): Promise<Response | null> {

  if (path === "/setup/status" && request.method === "GET") return json({ configured: adminConfigured() });
  if (path === "/admin/session" && request.method === "GET") {
    const authenticated = hasSession(request);
    const admin = authenticated ? sqlite.query("SELECT username FROM toolsmith_admin WHERE id = 1").get() as { username: string } | null : null;
    const csrfToken = randomToken();
    return json({ configured: adminConfigured(), authenticated, username: admin?.username, csrfToken }, 200, { "set-cookie": csrfCookieValue(csrfToken, request) });
  }

  const browserPost = request.method === "POST" &&
    (path === "/setup" || path === "/admin/login" || path.startsWith("/admin/"));
  const form = browserPost ? new URLSearchParams(await request.text()) : null;
  const origin = request.headers.get("origin");
  const originMismatch = Boolean(origin && origin !== "null" && !isSameOriginRequest(request));
  const csrfCookieToken = readCookie(request, csrfCookie);
  const csrfFormToken = form?.get("_csrf") ?? "";
  const csrfTokenValid = Boolean(csrfCookieToken && csrfFormToken && safeEqual(csrfCookieToken, csrfFormToken));
  if (browserPost && (originMismatch || !csrfTokenValid)) {
    logger.warn({
      event: "admin_csrf_rejected",
      method: request.method,
      path,
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      resolvedOrigin: requestOrigin(request),
    }, "Admin request rejected by same-origin protection");
    return json({ error: "Cross-origin request rejected" }, 403);
  }

  if (path === "/setup" && request.method === "POST") {
    if (adminConfigured()) return json({ error: "Setup already completed" }, 409);
    if (isLoginBlocked(request, "__setup__")) return json({ error: "Too many setup attempts. Try again later." }, 429);
    const formData = form!;
    const config = parse(await readFile(configFile, "utf8")) as { security?: { setup_token?: string } };
    const expectedSetupToken = config.security?.setup_token ?? "";
    if (!expectedSetupToken || !safeEqual(formData.get("setup_token") ?? "", expectedSetupToken)) {
      recordLoginFailure(request, "__setup__");
      return json({ error: "Invalid or expired setup token" }, 403);
    }
    clearLoginFailures(request, "__setup__");
    const user = formData.get("username") ?? "", pass = formData.get("password") ?? "";
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(user) || pass.length < 8 || pass !== formData.get("confirm")) return json({ error: "Username/password tidak valid atau konfirmasi tidak cocok." }, 400);
    const publicUrl = formData.get("public_url") ?? "";
    if (publicUrl) { try { const parsed = new URL(publicUrl); if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error(); } catch { return json({ error: "Public URL harus berupa origin HTTPS, contoh https://mcp.example.com" }, 400); } }
    const salt = randomBytes(16), api = randomBytes(32).toString("hex"), sudo = randomBytes(32).toString("hex");
    try {
      sqlite.query("INSERT INTO toolsmith_admin (id, username, salt, password_hash, created_at) VALUES (1, ?, ?, ?, ?)").run(user, salt.toString("hex"), passwordHash(pass, salt), now());
    } catch {
      return json({ error: "Setup already completed" }, 409);
    }
    try {
      await writeSecrets(api, sudo, user, publicUrl);
    } catch (error) {
      sqlite.query("DELETE FROM toolsmith_admin WHERE id = 1").run();
      throw error;
    }
    const token = randomToken();
    sqlite.query("INSERT INTO toolsmith_admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(hash(token), now() + 604800);
    return wantsJson(request) ? json({ ok: true, username: user }, 200, { "set-cookie": cookie(token, 604800, request) }) : new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(token, 604800, request), "cache-control": "no-store" } });
  }

  if (path === "/admin/login" && request.method === "POST") {
    const formData = form!, username = formData.get("username") ?? "";
    if (isLoginBlocked(request, username)) return json({ error: "Too many login attempts. Try again in 15 minutes." }, 429, { "retry-after": String(LOGIN_WINDOW_SECONDS) });
    if (!verifyAdmin(username, formData.get("password") ?? "")) {
      recordLoginFailure(request, username);
      return json({ error: "Username atau password salah." }, 401);
    }
    clearLoginFailures(request, username);
    const token = randomToken();
    sqlite.query("INSERT INTO toolsmith_admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(hash(token), now() + 604800);
    return wantsJson(request) ? json({ ok: true, username }, 200, { "set-cookie": cookie(token, 604800, request) }) : new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(token, 604800, request), "cache-control": "no-store" } });
  }

  if (path.startsWith("/admin/") && !hasSession(request)) return json({ error: "Unauthorized" }, 401);
  if (path === "/admin/logout" && request.method === "POST") {
    const token = sessionToken(request);
    if (token) sqlite.query("DELETE FROM toolsmith_admin_sessions WHERE token_hash = ?").run(hash(token));
    return wantsJson(request) ? json({ ok: true }, 200, { "set-cookie": cookie("", 0, request) }) : new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie("", 0, request), "cache-control": "no-store" } });
  }
  if (path === "/admin/token" && request.method === "GET") {
    const cfg = parse(await readFile(configFile, "utf8")) as any;
    return json({ token: String(cfg.security?.api_token ?? "") });
  }
  if (path === "/admin/token" && request.method === "POST") {
    const api = randomBytes(32).toString("hex"), raw = await readFile(configFile, "utf8"), cfg = (parse(raw) ?? {}) as any;
    cfg.security = { ...(cfg.security ?? {}), api_token: api };
    const temp = configFile + ".tmp";
    await writeFile(temp, stringify(cfg), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, configFile);
    await chmod(configFile, 0o600);
    process.env.TOOLSMITH_API_TOKEN = api;
    return json({ token: api });
  }
  return null;
}


function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function client(clientId: string): any {
  return sqlite.query("SELECT * FROM oauth_clients WHERE client_id = ?").get(clientId) as any;
}
function clientResponse(row: any) {
  return { client_id: row.client_id, client_name: row.client_name, redirect_uris: JSON.parse(row.redirect_uris), grant_types: JSON.parse(row.grant_types), response_types: JSON.parse(row.response_types), token_endpoint_auth_method: row.token_endpoint_auth_method, client_id_issued_at: row.created_at };
}
function validRedirect(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" || ((["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) && parsed.protocol === "http:");
  } catch { return false; }
}
function metadata(path: string, request: Request): Response {
  const { issuer, resourceUrl } = oauthConfig(request);
  if (!issuer || !resourceUrl) return json({ error: "OAuth is not configured." }, 503);
  if (path === "/.well-known/oauth-authorization-server") return json({
    issuer: issuer.origin,
    authorization_endpoint: new URL("/oauth/authorize", issuer).href,
    token_endpoint: new URL("/oauth/token", issuer).href,
    registration_endpoint: new URL("/oauth/register", issuer).href,
    revocation_endpoint: new URL("/oauth/revoke", issuer).href,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: scopes
  });
  return json({ resource: resourceUrl.href, authorization_servers: [issuer.origin], bearer_methods_supported: ["header"], scopes_supported: scopes });
}
export function isOAuthEndpoint(path: string): boolean {
  return path === "/favicon.ico" || path === "/favicon.svg" || path.startsWith("/_app/") || path === "/" || path === "/setup" || path === "/setup/status" || path.startsWith("/admin/") || path === "/.well-known/oauth-authorization-server" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource" + (process.env.MCP_HTTP_PATH ?? "/mcp") ||
    path.startsWith("/oauth/");
}
export async function handleOAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith("/oauth/")) {
    logger.info({ event: "oauth_http_request", method: request.method, path, origin: request.headers.get("origin"), userAgent: request.headers.get("user-agent"), contentType: request.headers.get("content-type") }, "OAuth HTTP request received");
  }
  if (path === "/favicon.ico" || path === "/favicon.svg") return uiAsset("/favicon.svg");
  if (path.startsWith("/_app/")) return uiAsset(path);
  if ((path === "/" || path === "/setup") && request.method === "GET") return uiShell();
  const admin = await adminRequest(request, path);
  if (admin) return admin;
  if (!oauthEnabled(request)) return json({ error: "OAuth is not configured. Send requests through an HTTPS reverse proxy or configure oauth.public_url as a fallback." }, 503);
  const { issuer, resourceUrl } = oauthConfig(request);
  sqlite.query("DELETE FROM oauth_codes WHERE expires_at < ?").run(now());
  sqlite.query("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now());
  if (path.startsWith("/.well-known/")) return metadata(path, request);

  if (path === "/oauth/register" && request.method === "POST") {
    const registrationLog = {
      event: "oauth_client_registration",
      method: request.method,
      path,
      origin: request.headers.get("origin"),
      userAgent: request.headers.get("user-agent"),
      contentType: request.headers.get("content-type"),
    };
    logger.info(registrationLog, "OAuth client registration request received");

    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      logger.warn({ ...registrationLog, outcome: "invalid_json", error: error instanceof Error ? error.message : String(error), status: 400 }, "OAuth client registration rejected");
      return json({ error: "invalid_client_metadata" }, 400);
    }

    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
    const registrationDetails = {
      ...registrationLog,
      clientName: typeof body?.client_name === "string" ? body.client_name.slice(0, 120) : "MCP client",
      redirectUris,
      grantTypes: body?.grant_types ?? null,
      responseTypes: body?.response_types ?? null,
      tokenEndpointAuthMethod: body?.token_endpoint_auth_method ?? "none",
    };

    if (!redirectUris.length || !redirectUris.every((uri: unknown) => typeof uri === "string" && validRedirect(uri))) {
      logger.warn({ ...registrationDetails, outcome: "invalid_redirect_uri", status: 400 }, "OAuth client registration rejected");
      return json({ error: "invalid_redirect_uri", error_description: "Redirect URIs must use HTTPS or localhost HTTP." }, 400);
    }
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
      logger.warn({ ...registrationDetails, outcome: "unsupported_token_endpoint_auth_method", status: 400 }, "OAuth client registration rejected");
      return json({ error: "invalid_client_metadata" }, 400);
    }

    const id = randomToken(), name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "MCP client";
    const grants = Array.isArray(body.grant_types) ? body.grant_types.filter((x: unknown) => ["authorization_code", "refresh_token"].includes(String(x))) : ["authorization_code", "refresh_token"];
    const responses = Array.isArray(body.response_types) ? body.response_types.filter((x: unknown) => x === "code") : ["code"];
    try {
      sqlite.query("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, ?, ?, 'none', ?)").run(id, name, JSON.stringify(redirectUris), JSON.stringify(grants.length ? grants : ["authorization_code"]), JSON.stringify(responses.length ? responses : ["code"]), now());
      const registeredClient = client(id);
      logger.info({ ...registrationDetails, outcome: "registered", clientId: id, status: 201 }, "OAuth client registered");
      return json(clientResponse(registeredClient), 201);
    } catch (error) {
      logger.error({ ...registrationDetails, outcome: "database_error", status: 500, error: error instanceof Error ? error.message : String(error) }, "OAuth client registration failed");
      return json({ error: "server_error" }, 500);
    }
  }

  if (path === "/oauth/authorize" && request.method === "GET") {
    const row = client(url.searchParams.get("client_id") ?? "");
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    if (!row || !JSON.parse(row.redirect_uris).includes(redirect)) return json({ error: "invalid_request", error_description: "Unknown client or redirect_uri." }, 400);
    if (url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) return json({ error: "invalid_request", error_description: "Authorization code with PKCE S256 is required." }, 400);
    if (url.searchParams.get("resource") && url.searchParams.get("resource") !== resourceUrl!.href) return json({ error: "invalid_target" }, 400);
    const oauthCsrfToken = randomToken();
    const authorizeParams = new URLSearchParams(url.search);
    sqlite.query("DELETE FROM oauth_authorize_csrf WHERE expires_at <= ?").run(now());
    const csrfTokenHash = hash(oauthCsrfToken);
    sqlite.query("INSERT INTO oauth_authorize_csrf (token_hash, request_hash, expires_at) VALUES (?, ?, ?)").run(csrfTokenHash, oauthAuthorizeRequestHash(authorizeParams), now() + oauthAuthorizeCsrfLifetime);
    logger.info({ event: "oauth_authorize_csrf_issued", pid: process.pid, tokenFingerprint: csrfTokenHash.slice(0, 12), stored: Boolean(sqlite.query("SELECT token_hash FROM oauth_authorize_csrf WHERE token_hash = ?").get(csrfTokenHash)) }, "OAuth authorization CSRF token issued");
    return uiShell(200, oauthCsrfToken);
  }

  if (path === "/oauth/authorize" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    const origin = request.headers.get("origin");
    const csrfFormToken = form.get("_oauth_csrf") ?? "";
    const csrfTokenHash = csrfFormToken ? hash(csrfFormToken) : "";
    const csrfRecord = csrfFormToken ? sqlite.query("SELECT request_hash FROM oauth_authorize_csrf WHERE token_hash = ? AND expires_at > ?").get(csrfTokenHash, now()) as { request_hash: string } | null : null;
    const csrfRequestHashMatches = Boolean(csrfRecord && safeEqual(csrfRecord.request_hash, oauthAuthorizeRequestHash(form)));
    const csrfTokenValid = Boolean(csrfFormToken && csrfRecord && csrfRequestHashMatches);
    logger.info({ event: "oauth_authorize_csrf_received", pid: process.pid, tokenFingerprint: csrfTokenHash ? csrfTokenHash.slice(0, 12) : null, recordFound: Boolean(csrfRecord) }, "OAuth authorization CSRF token received");
    const sameOrigin = origin === "null" ? csrfTokenValid : isSameOriginRequest(request) && csrfTokenValid;
    let refererOrigin: string | null = null;
    try {
      const referer = request.headers.get("referer");
      if (referer) refererOrigin = new URL(referer).origin;
    } catch {}
    let cfVisitorScheme: string | null = null;
    try {
      const visitor = request.headers.get("cf-visitor");
      if (visitor) {
        const scheme = JSON.parse(visitor).scheme;
        if (typeof scheme === "string") cfVisitorScheme = scheme;
      }
    } catch {}
    let requestUrlOrigin: string | null = null;
    try { requestUrlOrigin = new URL(request.url).origin; } catch {}
    logger.debug({
      event: "oauth_authorize_origin_check",
      method: request.method,
      path,
      outcome: sameOrigin ? "accepted" : "rejected",
      csrfTokenValid,
      origin: request.headers.get("origin"),
      refererOrigin,
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
      cfVisitorScheme,
      requestUrlOrigin,
      resolvedOrigin: requestOrigin(request),
    }, "OAuth authorization origin check");
    if (!sameOrigin) {
      logger.warn({ event: "oauth_authorize_rejected", csrfTokenPresent: Boolean(csrfFormToken), csrfRecordFound: Boolean(csrfRecord), csrfRequestHashMatches, csrfTokenValid, origin, refererOrigin, requestUrlOrigin, resolvedOrigin: requestOrigin(request) }, "OAuth authorization rejected by origin/CSRF protection");
      return json({ error: "Cross-origin request rejected" }, 403);
    }
    const submittedUsername = form.get("username") ?? "";
    if (isLoginBlocked(request, submittedUsername)) return json({ error: "Too many login attempts. Try again in 15 minutes." }, 429, { "retry-after": String(LOGIN_WINDOW_SECONDS) });
    const clientId = form.get("client_id") ?? "", row = client(clientId);
    const redirect = form.get("redirect_uri") ?? "", challenge = form.get("code_challenge") ?? "";
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) if (key !== "username" && key !== "password") params.append(key, value);
    if (!row || !JSON.parse(row.redirect_uris).includes(redirect) || form.get("response_type") !== "code" || form.get("code_challenge_method") !== "S256" || !challenge) return json({ error: "invalid_request" }, 400);
    if (!verifyAdmin(form.get("username") ?? "", form.get("password") ?? "")) {
      recordLoginFailure(request, form.get("username") ?? "");
      const failedUrl = new URL(request.url);
      for (const [key, value] of params) failedUrl.searchParams.set(key, value);
      failedUrl.searchParams.set("error", "invalid_credentials");
      return Response.redirect(failedUrl.href, 303);
    }
    sqlite.query("DELETE FROM oauth_authorize_csrf WHERE token_hash = ?").run(csrfTokenHash);
    clearLoginFailures(request, form.get("username") ?? "");
    const resource = form.get("resource") || resourceUrl!.href;
    if (resource !== resourceUrl!.href) return json({ error: "invalid_target" }, 400);
    const code = randomToken();
    sqlite.query("INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(hash(code), clientId, redirect, challenge, form.get("state"), JSON.stringify((form.get("scope") ?? "mcp:tools").split(/\s+/).filter((s) => scopes.includes(s))), resource, now() + 300);
    const target = new URL(redirect); target.searchParams.set("code", code);
    const state = form.get("state"); if (state !== null) target.searchParams.set("state", state);
    return Response.redirect(target.href, 302);
  }

  if (path === "/oauth/token" && request.method === "POST") {
    const form = new URLSearchParams(await request.text()), grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    if (!client(clientId)) return json({ error: "invalid_client" }, 401);
    if (grant === "authorization_code") {
      const code = form.get("code") ?? "";
      const saved = sqlite.query("SELECT * FROM oauth_codes WHERE code_hash = ?").get(hash(code)) as any;
      if (!saved || saved.client_id !== clientId || saved.expires_at < now() || saved.redirect_uri !== form.get("redirect_uri") || saved.resource !== resourceUrl!.href) return json({ error: "invalid_grant" }, 400);
      const verifier = form.get("code_verifier") ?? "";
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash("sha256").update(verifier).digest("base64url") !== saved.code_challenge) return json({ error: "invalid_grant" }, 400);
      sqlite.query("DELETE FROM oauth_codes WHERE code_hash = ?").run(hash(code));
      return issueTokens(clientId, JSON.parse(saved.scopes), saved.resource);
    }
    if (grant === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      const saved = sqlite.query("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh'").get(hash(refresh)) as any;
      if (!saved || saved.client_id !== clientId || saved.expires_at < now()) return json({ error: "invalid_grant" }, 400);
      sqlite.query("DELETE FROM oauth_tokens WHERE token_hash = ?").run(hash(refresh));
      return issueTokens(clientId, JSON.parse(saved.scopes), saved.resource);
    }
    return json({ error: "unsupported_grant_type" }, 400);
  }
  if (path === "/oauth/revoke" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    const clientId = form.get("client_id") ?? "";
    const tokenHash = hash(form.get("token") ?? "");
    const saved = sqlite.query("SELECT client_id FROM oauth_tokens WHERE token_hash = ?").get(tokenHash) as { client_id: string } | null;
    if (saved?.client_id === clientId) sqlite.query("DELETE FROM oauth_tokens WHERE token_hash = ?").run(tokenHash);
    return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  }
  return new Response("Not found", { status: 404 });
}
function issueTokens(clientId: string, tokenScopes: string[], resource: string): Response {
  const access = randomToken(), refresh = randomToken(), issued = now();
  sqlite.query("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes, resource, expires_at, created_at) VALUES (?, ?, 'access', ?, ?, ?, ?)").run(hash(access), clientId, JSON.stringify(tokenScopes), resource, issued + 3600, issued);
  sqlite.query("INSERT INTO oauth_tokens (token_hash, client_id, token_type, scopes, resource, expires_at, created_at) VALUES (?, ?, 'refresh', ?, ?, ?, ?)").run(hash(refresh), clientId, JSON.stringify(tokenScopes), resource, issued + 2592000, issued);
  return json({ access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: tokenScopes.join(" ") });
}
export async function verifyOAuthAccessToken(token: string, request: Request): Promise<{ token: string; clientId: string; scopes: string[]; expiresAt: number; resource: string } | null> {
  const { resourceUrl } = oauthConfig(request);
  if (!oauthEnabled(request) || !resourceUrl) return null;
  const row = sqlite.query("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'").get(hash(token)) as any;
  if (!row || row.expires_at < now() || row.resource !== resourceUrl.href) return null;
  return { token, clientId: row.client_id, scopes: JSON.parse(row.scopes), expiresAt: row.expires_at, resource: row.resource };
}
