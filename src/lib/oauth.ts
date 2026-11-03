import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import { homedir } from "node:os";
import { join } from "node:path";
import { sqlite } from "../control-plane/db";

const configFile = process.env.TOOLSMITH_CONFIG ?? (process.env.NODE_ENV === "production" ? join(homedir(), ".toolsmith", "config", "config.yml") : join(process.cwd(), ".toolsmith", "config.yml"));
function oauthConfig() {
  const publicUrlValue = process.env.MCP_PUBLIC_URL?.trim();
  const issuer = publicUrlValue ? new URL(publicUrlValue) : null;
  const resourceUrl = issuer ? new URL(process.env.MCP_HTTP_PATH ?? "/mcp", issuer) : null;
  return { issuer, resourceUrl };
}
const scopes = ["mcp:tools"];
const now = () => Math.floor(Date.now() / 1000);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const randomToken = () => randomBytes(32).toString("base64url");
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store", pragma: "no-cache" } });
function oauthEnabled() { const { issuer, resourceUrl } = oauthConfig(); return Boolean(issuer && issuer.protocol === "https:" && issuer.pathname === "/" && !issuer.search && !issuer.hash && resourceUrl); }

sqlite.exec(`CREATE TABLE IF NOT EXISTS toolsmith_admin (id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS toolsmith_admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
const sessionCookie = "toolsmith_session";
function adminConfigured() { return Boolean(sqlite.query("SELECT id FROM toolsmith_admin WHERE id = 1").get()); }
function passwordHash(password: string, salt: Buffer) { return scryptSync(password, salt, 64).toString("hex"); }
function verifyAdmin(user: string, pass: string) { const row = sqlite.query("SELECT username, salt, password_hash FROM toolsmith_admin WHERE id = 1").get() as any; return Boolean(row && safeEqual(user, row.username) && safeEqual(passwordHash(pass, Buffer.from(row.salt, "hex")), row.password_hash)); }
function sessionToken(request: Request) { return (request.headers.get("cookie") ?? "").split(";").map(x => x.trim()).find(x => x.startsWith(sessionCookie + "="))?.slice(sessionCookie.length + 1) ?? ""; }
function hasSession(request: Request) { const token = sessionToken(request); if (!token) return false; sqlite.query("DELETE FROM toolsmith_admin_sessions WHERE expires_at < ?").run(now()); return Boolean(sqlite.query("SELECT token_hash FROM toolsmith_admin_sessions WHERE token_hash = ? AND expires_at > ?").get(hash(token), now())); }
function cookie(token: string, maxAge: number) { return sessionCookie + "=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (new URL(process.env.MCP_PUBLIC_URL || "http://localhost").protocol === "https:" ? "; Secure" : ""); }
function html(body: string, authenticated = false) {
  const page = `'<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Toolsmith</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%235e6ad2%22%2F%3E%3Ctext x=%2250%25%22 y=%2252%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22%3ET%3C%2Ftext%3E%3C%2Fsvg%3E"><style>
:root{color-scheme:light;--canvas:#fafafa;--surface:#fff;--raised:#fff;--hover:#f5f5f5;--line:#e5e5e5;--line-strong:#d4d4d4;--fg:#0a0a0a;--muted:#737373;--subtle:#a3a3a3;--accent:#5e6ad2;--accent-hover:#4f5bc4;--danger:#d93f3f;--success:#2d9d6b}
.dark{color-scheme:dark;--canvas:#0a0a0a;--surface:#0a0a0a;--raised:#171717;--hover:#262626;--line:#262626;--line-strong:#404040;--fg:#fafafa;--muted:#a3a3a3;--subtle:#737373;--accent:#7c86e8;--accent-hover:#5e6ad2;--danger:#eb5757;--success:#4cb782}
*{box-sizing:border-box}html{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}body{min-height:100vh;margin:0;background:var(--canvas);color:var(--fg);font-size:14px}.frame{min-height:100vh;padding:clamp(12px,3vw,32px);display:flex}.shell{width:100%;max-width:1200px;min-height:calc(100vh - clamp(24px,6vw,64px));margin:auto;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.brand{display:flex;flex-direction:column;justify-content:space-between;padding:clamp(32px,5vw,56px);border-right:1px solid var(--line);background:var(--raised)}.shell.authenticated .brand{display:none}.shell.authenticated{grid-template-columns:minmax(0,1fr)}.shell.authenticated .panel{min-height:440px;display:flex;align-items:center;justify-content:center;padding:clamp(28px,6vw,64px)}.shell.authenticated .content{width:100%;max-width:480px}.brand-head{display:flex;align-items:center;gap:12px;font-weight:600}.logo{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;font-weight:600}.brand-copy{max-width:440px;margin:48px 0}.eyebrow{margin:0 0 16px;color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}.brand h2{margin:0;font-size:clamp(38px,4vw,52px);line-height:1.1;letter-spacing:-.045em}.brand-copy>p:last-of-type{max-width:360px;margin-top:20px;color:var(--muted);line-height:1.7}.brand-foot{color:var(--subtle);font-size:12px}.panel{display:flex;align-items:center;justify-content:center;min-width:0;padding:clamp(28px,5vw,64px)}.content{width:100%;max-width:360px}.content h1{margin:0 0 8px;font-size:24px;letter-spacing:-.03em}.content p{color:var(--muted);line-height:1.65}.content label{display:block;margin:20px 0 8px;font-weight:500;color:var(--fg)}.content input{width:100%;min-width:0;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);outline:none;transition:border-color .15s,box-shadow .15s}.content input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.content button{width:100%;margin-top:20px;padding:12px 16px;border:0;border-radius:8px;background:var(--accent);color:white;font:inherit;font-weight:500;cursor:pointer;transition:background .15s,opacity .15s}.content button:hover{background:var(--accent-hover)}.content button:disabled{opacity:.55;cursor:wait}.content a{color:var(--accent);text-decoration:none}.content a:hover{text-decoration:underline}.muted{font-size:13px;color:var(--subtle)!important}.error{color:var(--danger)!important}.token{overflow-wrap:anywhere;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--raised);font-family:ui-monospace,monospace}.password-wrap{position:relative}.password-wrap input{padding-right:48px}.password-toggle{position:absolute;top:50%;right:4px;transform:translateY(-50%);width:36px!important;height:36px;margin:0!important;padding:0!important;border:0!important;border-radius:6px!important;background:transparent!important;color:var(--muted)!important;display:grid;place-items:center}.password-toggle:hover{background:var(--hover)!important;color:var(--fg)!important}.password-toggle svg{width:18px;height:18px}.password-toggle .slash{display:block}.password-toggle.password-visible .slash{display:none}.theme-toggle{position:fixed;z-index:5;top:20px;right:20px;width:38px!important;height:38px;margin:0!important;padding:0!important;border:1px solid var(--line)!important;border-radius:9px!important;background:var(--surface)!important;color:var(--fg)!important;display:grid;place-items:center}.theme-toggle:hover{background:var(--hover)!important}.theme-toggle svg{width:17px;height:17px}@media(max-width:760px){.shell{max-width:480px;min-height:calc(100vh - 24px);grid-template-columns:1fr}.brand{display:none}.panel{padding:76px 28px 36px}.theme-toggle{top:16px;right:16px}}
</style><script>try{const t=localStorage.getItem("toolsmith-oauth-theme");document.documentElement.classList.toggle("dark",t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches)}catch{}</script></head><body><button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle theme" title="Toggle theme"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg></button><div class="frame"><main class="shell${authenticated ? " authenticated" : ""}"><section class="brand"><div class="brand-head"><span class="logo">T</span><span>Toolsmith</span></div><div class="brand-copy"><p class="eyebrow">One workspace. Full control.</p><h2>Your tools,<br>connected.</h2><p>Kelola akses aman ke Toolsmith dan hubungkan client MCP Anda.</p></div><p class="brand-foot">Private workspace</p></section><section class="panel"><div class="content">${body}</div></section></main></div><script>document.addEventListener("click",e=>{const b=e.target.closest(".password-toggle");if(b){const i=b.parentElement.querySelector("input"),v=i.type==="password";i.type=v?"text":"password";b.classList.toggle("password-visible",v);b.setAttribute("aria-label",v?"Sembunyikan password":"Tampilkan password");b.title=v?"Sembunyikan password":"Tampilkan password";return}if(e.target.closest("#theme-toggle")){const r=document.documentElement;r.classList.toggle("dark");try{localStorage.setItem("toolsmith-oauth-theme",r.classList.contains("dark")?"dark":"light")}catch{}}});document.getElementById("reveal-api-token")?.addEventListener("click",async function(){const el=document.getElementById("api-token");if(el.dataset.revealed==="true"){el.textContent="••••••••••••••••••••••••••••••••";el.dataset.revealed="false";this.textContent="Tampilkan";return}this.disabled=true;try{const response=await fetch("/admin/token",{credentials:"same-origin"});document.getElementById("copy-api-token")?.addEventListener("click",async function(){const el=document.getElementById("api-token");let token=el.dataset.revealed==="true"?el.textContent:"";if(!token){this.disabled=true;try{const response=await fetch("/admin/token",{credentials:"same-origin"});const markup=await response.text();const doc=new DOMParser().parseFromString(markup,"text/html");token=doc.querySelector(".token")?.textContent??""}catch{}finally{this.disabled=false}}if(!token||token==="Token tidak ditemukan"){this.textContent="Gagal";return}try{await navigator.clipboard.writeText(token);this.textContent="Tersalin";setTimeout(()=>this.textContent="Copy",1500)}catch{this.textContent="Gagal menyalin"}});const markup=await response.text();const doc=new DOMParser().parseFromString(markup,"text/html");el.textContent=doc.querySelector(".token")?.textContent??"Token tidak ditemukan";el.dataset.revealed="true";this.textContent="Sembunyikan"}catch{el.textContent="Gagal memuat token";el.dataset.revealed="true"}finally{this.disabled=false}});</script></body></html>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
async function writeSecrets(apiToken: string, sudoKey: string, username: string, publicUrl: string) { await mkdir(join(configFile, ".."), { recursive: true, mode: 0o700 }); const raw = existsSync(configFile) ? await readFile(configFile, "utf8") : "server:\n  host: 127.0.0.1\n  port: 48766\n  path: /mcp\n  transport: http\n"; const cfg = (parse(raw) ?? {}) as any; cfg.security = { ...(cfg.security ?? {}), api_token: apiToken, sudo_encryption_key: sudoKey }; cfg.oauth = { ...(cfg.oauth ?? {}), username, password: "", public_url: publicUrl }; const tmp = configFile + ".tmp"; await writeFile(tmp, stringify(cfg), { mode: 0o600 }); await chmod(tmp, 0o600); await writeFile(configFile, await readFile(tmp)); await chmod(configFile, 0o600); await Bun.file(tmp).delete(); process.env.TOOLSMITH_API_TOKEN = apiToken; process.env.TOOLSMITH_SUDO_ENCRYPTION_KEY = sudoKey; process.env.TOOLSMITH_OAUTH_USERNAME = username; process.env.TOOLSMITH_OAUTH_PASSWORD = ""; if (publicUrl) process.env.MCP_PUBLIC_URL = publicUrl; }
function adminPage(request: Request): Response { if (!adminConfigured()) return html('<h1>Welcome to Toolsmith</h1><p>Initial setup. Buat akun administrator untuk mengamankan server.</p><form method="post" action="/setup"><label>Username</label><input name="username" minlength="3" maxlength="32" required pattern="[A-Za-z0-9._-]+"><label>Password (minimal 8 karakter)</label><div class="password-wrap"><input type="password" name="password" minlength="8" required><button type="button" class="password-toggle" aria-label="Tampilkan password" title="Tampilkan password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="m3 3 18 18"/></svg></button></div><label>Konfirmasi password</label><div class="password-wrap"><input type="password" name="confirm" minlength="8" required><button type="button" class="password-toggle" aria-label="Tampilkan password" title="Tampilkan password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="m3 3 18 18"/></svg></button></div><label>Public URL (HTTPS, opsional)</label><input type="url" name="public_url" placeholder="https://mcp.example.com"><button>Buat administrator</button></form><p class="muted">Initial setup hanya tersedia melalui localhost.</p>'); if (!hasSession(request)) return html('<h1>Toolsmith</h1><p>Login administrator untuk mengelola akses server.</p><form method="post" action="/admin/login"><label>Username</label><input name="username" autocomplete="username" required><label>Password</label><input type="password" name="password" autocomplete="current-password" required><button>Login</button></form>'); return html('<h1>Toolsmith settings</h1><p>Administrator: ' + escapeHtml(String((sqlite.query("SELECT username FROM toolsmith_admin WHERE id=1").get() as any)?.username ?? "")) + '</p><p>API token: <code id="api-token">••••••••••••••••••••••••••••••••</code> <button type="button" id="reveal-api-token">Tampilkan</button> <button type="button" id="copy-api-token">Copy</button></p><form method="post" action="/admin/token"><button>Generate API token baru</button></form><form method="post" action="/admin/logout"><button>Logout</button></form><p class="muted">API token baru ditampilkan satu kali setelah dibuat.</p>', true); }
async function adminRequest(request: Request, path: string): Promise<Response | null> {
  if (path === "/" && request.method === "GET") return adminPage(request);
  if (path === "/setup/status" && request.method === "GET") return json({ configured: adminConfigured() });
  if (path === "/setup" && request.method === "POST") {
    if (adminConfigured()) return json({ error: "Setup already completed" }, 409);
    const host = new URL(request.url).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return json({ error: "Initial setup is only allowed through localhost. Use an SSH tunnel." }, 403);
    const form = new URLSearchParams(await request.text()), user = form.get("username") ?? "", pass = form.get("password") ?? "";
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(user) || pass.length < 8 || pass !== form.get("confirm")) return html('<h1>Setup gagal</h1><p class="error">Username/password tidak valid atau konfirmasi tidak cocok.</p><a href="/">Coba lagi</a>');
    const publicUrl = form.get("public_url") ?? "";
    if (publicUrl) { try { const parsed = new URL(publicUrl); if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error(); } catch { return html('<h1>Setup gagal</h1><p class="error">Public URL harus berupa origin HTTPS, contoh https://mcp.example.com</p><a href="/">Coba lagi</a>'); } }
    const salt = randomBytes(16), api = randomBytes(32).toString("hex"), sudo = randomBytes(32).toString("hex");
    await writeSecrets(api, sudo, user, publicUrl);
    sqlite.query("INSERT INTO toolsmith_admin (id, username, salt, password_hash, created_at) VALUES (1, ?, ?, ?, ?)").run(user, salt.toString("hex"), passwordHash(pass, salt), now());
    const token = randomBytes(32).toString("base64url"); sqlite.query("INSERT INTO toolsmith_admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(hash(token), now() + 604800);
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(token, 604800), "cache-control": "no-store" } });
  }
  if (path === "/admin/login" && request.method === "POST") { const form = new URLSearchParams(await request.text()); if (!verifyAdmin(form.get("username") ?? "", form.get("password") ?? "")) return html('<h1>Login gagal</h1><p class="error">Username atau password salah.</p><a href="/">Coba lagi</a>'); const token = randomBytes(32).toString("base64url"); sqlite.query("INSERT INTO toolsmith_admin_sessions (token_hash, expires_at) VALUES (?, ?)").run(hash(token), now() + 604800); return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie(token, 604800), "cache-control": "no-store" } }); }
  if (path.startsWith("/admin/") && !hasSession(request)) return json({ error: "Unauthorized" }, 401);
  if (path === "/admin/logout" && request.method === "POST") { const token = sessionToken(request); if (token) sqlite.query("DELETE FROM toolsmith_admin_sessions WHERE token_hash = ?").run(hash(token)); return new Response(null, { status: 303, headers: { location: "/", "set-cookie": cookie("", 0), "cache-control": "no-store" } }); }
  if (path === "/admin/token" && request.method === "GET") { const cfg = parse(await readFile(configFile, "utf8")) as any; return html('<h1>API token</h1><p class="token">' + escapeHtml(String(cfg.security?.api_token ?? "Not configured")) + '</p><a href="/">Kembali</a>'); }
  if (path === "/admin/token" && request.method === "POST") { const api = randomBytes(32).toString("hex"); const raw = await readFile(configFile, "utf8"), cfg = (parse(raw) ?? {}) as any; cfg.security = { ...(cfg.security ?? {}), api_token: api }; await writeFile(configFile, stringify(cfg), { mode: 0o600 }); await chmod(configFile, 0o600); process.env.TOOLSMITH_API_TOKEN = api; return html('<h1>API token baru</h1><p class="token">' + api + '</p><p>Simpan token ini sekarang. Nilainya tidak akan ditampilkan lagi.</p><a href="/">Kembali</a>'); }
  return null;
}


function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
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
function loginPage(params: URLSearchParams, error = ""): Response {
  const hidden = [...params.entries()].map(([key, value]) => '<input type="hidden" name="' + escapeHtml(key) + '" value="' + escapeHtml(value) + '">').join("");
  const html = [
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Toolsmith</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2214%22 fill=%22%235e6ad2%22%2F%3E%3Ctext x=%2250%25%22 y=%2252%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2240%22 fill=%22white%22%3ET%3C%2Ftext%3E%3C%2Fsvg%3E">',
    '<style>:root{color-scheme:light;--canvas:#fafafa;--surface:#fff;--raised:#fff;--line:#e5e5e5;--line-strong:#d4d4d4;--fg:#0a0a0a;--muted:#737373;--accent:#5e6ad2;--accent-hover:#4f5bc4;--danger:#d93f3f}*{box-sizing:border-box}html{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}body{min-height:100vh;margin:0;background:var(--canvas);color:var(--fg);font-size:14px}.frame{min-height:100vh;padding:clamp(12px,3vw,32px);display:flex}.shell{width:100%;max-width:1200px;min-height:calc(100vh - clamp(24px,6vw,64px));margin:auto;display:grid;grid-template-columns:1fr 1fr;overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.brand{display:flex;flex-direction:column;justify-content:space-between;padding:clamp(32px,5vw,56px);border-right:1px solid var(--line);background:var(--raised)}.brand-head{display:flex;align-items:center;gap:12px;font-weight:600;letter-spacing:-.02em}.logo{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:var(--surface);font-size:14px}.brand-copy{max-width:420px;margin:auto 0;padding:48px 0}.eyebrow{margin:0 0 16px;color:#a3a3a3;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase}.brand h2{margin:0;font-size:clamp(34px,4vw,52px);font-weight:600;line-height:1.1;letter-spacing:-.055em}.brand-copy>p:last-of-type{max-width:330px;margin:20px 0 0;color:var(--muted);font-size:14px;line-height:1.8}.graphic{display:flex;align-items:center;gap:12px;margin-top:44px}.node{width:40px;height:40px;display:grid;place-items:center;border:1px solid var(--line);border-radius:12px;color:var(--muted)}.node.active{border-color:#5e6ad24d;background:#5e6ad20d;color:var(--accent)}.connector{width:28px;height:1px;background:var(--line-strong)}.brand-foot{margin:0;color:#a3a3a3;font-size:12px}.content{display:flex;align-items:center;justify-content:center;padding:clamp(24px,5vw,64px)}.form-wrap{width:100%;max-width:360px}.mobile-brand{display:none;margin-bottom:36px}.mobile-brand .brand-head{margin-bottom:20px}.mobile-brand p{margin:0;color:var(--muted);font-size:12px}.heading{margin-bottom:30px}.heading h1{margin:0;font-size:25px;font-weight:600;letter-spacing:-.04em}.heading p{margin:9px 0 0;color:var(--muted);font-size:14px;line-height:1.65}.error{margin:0 0 20px;padding:11px 12px;border:1px solid #d93f3f33;border-radius:8px;background:#d93f3f0d;color:var(--danger);font-size:13px}.field{margin-top:20px}.field label{display:block;margin-bottom:8px;font-size:13px;font-weight:500}.field input{display:block;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg);font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}.field input::placeholder{color:#a3a3a3}.field input:focus{border-color:var(--accent);box-shadow:0 0 0 3px #5e6ad21a}button{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;margin-top:26px;padding:12px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:500 13px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .15s}button:hover{background:var(--accent-hover)}button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.footer{margin-top:32px;padding-top:20px;border-top:1px solid var(--line);color:#a3a3a3;font-size:11px;text-align:center}@media(max-width:760px){.frame{padding:0}.shell{min-height:100vh;grid-template-columns:1fr;border:0;border-radius:0}.brand{display:none}.content{padding:36px 24px}.mobile-brand{display:block}.form-wrap{max-width:380px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}</style>',
    '<style>.password-wrap{position:relative}.password-wrap input{padding-right:46px}.password-toggle{position:absolute;top:50%;right:4px;transform:translateY(-50%);width:36px;height:36px;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:var(--muted);display:grid;place-items:center}.password-toggle:hover{background:var(--raised);color:var(--fg)}.password-toggle svg{width:18px;height:18px}.password-toggle .slash{display:block}.password-toggle.password-visible .slash{display:none}</style>',
    '<style>.dark{color-scheme:dark;--canvas:#0a0a0a;--surface:#0a0a0a;--raised:#171717;--line:#262626;--line-strong:#404040;--fg:#fafafa;--muted:#a3a3a3;--accent:#7c86e8;--accent-hover:#5e6ad2;--danger:#eb5757}.theme-toggle{position:fixed;z-index:5;top:20px;right:20px;width:38px;height:38px;margin:0;padding:0;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--fg);display:grid;place-items:center;cursor:pointer}.theme-toggle:hover{background:var(--raised)}.theme-toggle svg{width:17px;height:17px}@media(max-width:760px){.theme-toggle{top:16px;right:16px}}</style>',
    '<script>try{const t=localStorage.getItem("toolsmith-oauth-theme");document.documentElement.classList.toggle("dark",t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches)}catch{}</script>',
    '<button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg></button>',
    '<script>document.addEventListener("DOMContentLoaded",()=>{const b=document.getElementById("theme-toggle"),r=document.documentElement;function sync(){const d=r.classList.contains("dark");b.setAttribute("aria-label",d?"Switch to light mode":"Switch to dark mode");b.textContent=d?"☀":"☾"}sync();b.addEventListener("click",()=>{r.classList.toggle("dark");try{localStorage.setItem("toolsmith-oauth-theme",r.classList.contains("dark")?"dark":"light")}catch{}sync()})})</script>',
    '<div class="frame"><main class="shell"><section class="brand"><div class="brand-head"><span class="logo">T</span><span>Toolsmith</span></div><div class="brand-copy"><p class="eyebrow">One workspace. Full control.</p><h2>Your tools,<br>connected.</h2><p>Kelola akses aman ke Toolsmith dan hubungkan client MCP Anda.</p><div class="graphic" aria-hidden="true"><span class="node"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg></span><span class="connector"></span><span class="node"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z"/><path d="m4.5 7 7.5 4 7.5-4M12 11v10"/></svg></span><span class="connector"></span><span class="node active"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span></div></div><p class="brand-foot">Private workspace · Secure access</p></section><section class="content"><div class="form-wrap"><div class="mobile-brand"><div class="brand-head"><span class="logo">T</span><span>Toolsmith</span></div><p>Secure MCP authorization</p></div><header class="heading"><h1>Connect Toolsmith</h1><p>Masuk untuk memberi izin kepada client MCP agar dapat mengakses tools Toolsmith Anda.</p></header>',
    error ? '<p class="error" role="alert">' + escapeHtml(error) + '</p>' : '',
    '<form method="post" action="/oauth/authorize">' + hidden + '<div class="field"><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Masukkan username" required></div><div class="field"><label for="password">Password</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Masukkan password" required><button type="button" id="password-toggle" class="password-toggle" aria-label="Tampilkan password" title="Tampilkan password"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="M3 3l18 18"/></svg></button></div></div><button type="submit">Authorize connection <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10h12M10 4l6 6-6 6"/></svg></button></form><script>document.addEventListener("DOMContentLoaded",()=>{const input=document.getElementById("password"),button=document.getElementById("password-toggle");if(!input||!button)return;button.addEventListener("click",()=>{const visible=input.type==="password";input.type=visible?"text":"password";button.classList.toggle("password-visible",visible);button.setAttribute("aria-label",visible?"Sembunyikan password":"Tampilkan password");button.setAttribute("title",visible?"Sembunyikan password":"Tampilkan password")})})</script><p class="footer">Secure authorization · Toolsmith</p></div></section></main></div></html>'
  ].join("");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
function metadata(path: string): Response {
  const { issuer, resourceUrl } = oauthConfig();
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
  return path === "/favicon.ico" || path === "/" || path === "/setup" || path === "/setup/status" || path.startsWith("/admin/") || path === "/.well-known/oauth-authorization-server" ||
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource" + (process.env.MCP_HTTP_PATH ?? "/mcp") ||
    path.startsWith("/oauth/");
}
export async function handleOAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (path === "/favicon.ico") return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#5e6ad2"/><text x="32" y="44" text-anchor="middle" font-size="42" fill="white">T</text></svg>`, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
  const admin = await adminRequest(request, path);
  if (admin) return admin;
  if (!oauthEnabled()) return json({ error: "OAuth is not configured. Configure oauth.public_url in config.yml before connecting remote MCP clients." }, 503);
  const { issuer, resourceUrl } = oauthConfig();
  sqlite.query("DELETE FROM oauth_codes WHERE expires_at < ?").run(now());
  sqlite.query("DELETE FROM oauth_tokens WHERE expires_at < ?").run(now());
  if (path.startsWith("/.well-known/")) return metadata(path);

  if (path === "/oauth/register" && request.method === "POST") {
    let body: any;
    try { body = await request.json(); } catch { return json({ error: "invalid_client_metadata" }, 400); }
    if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || !body.redirect_uris.every((uri: unknown) => typeof uri === "string" && validRedirect(uri))) {
      return json({ error: "invalid_redirect_uri", error_description: "Redirect URIs must use HTTPS or localhost HTTP." }, 400);
    }
    if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") return json({ error: "invalid_client_metadata" }, 400);
    const id = randomToken(), name = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : "MCP client";
    const grants = Array.isArray(body.grant_types) ? body.grant_types.filter((x: unknown) => ["authorization_code", "refresh_token"].includes(String(x))) : ["authorization_code", "refresh_token"];
    const responses = Array.isArray(body.response_types) ? body.response_types.filter((x: unknown) => x === "code") : ["code"];
    sqlite.query("INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at) VALUES (?, ?, ?, ?, ?, 'none', ?)").run(id, name, JSON.stringify(body.redirect_uris), JSON.stringify(grants.length ? grants : ["authorization_code"]), JSON.stringify(responses.length ? responses : ["code"]), now());
    return json(clientResponse(client(id)), 201);
  }

  if (path === "/oauth/authorize" && request.method === "GET") {
    const row = client(url.searchParams.get("client_id") ?? "");
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    if (!row || !JSON.parse(row.redirect_uris).includes(redirect)) return json({ error: "invalid_request", error_description: "Unknown client or redirect_uri." }, 400);
    if (url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) return json({ error: "invalid_request", error_description: "Authorization code with PKCE S256 is required." }, 400);
    if (url.searchParams.get("resource") && url.searchParams.get("resource") !== resourceUrl!.href) return json({ error: "invalid_target" }, 400);
    return loginPage(url.searchParams);
  }

  if (path === "/oauth/authorize" && request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    const clientId = form.get("client_id") ?? "", row = client(clientId);
    const redirect = form.get("redirect_uri") ?? "", challenge = form.get("code_challenge") ?? "";
    const params = new URLSearchParams();
    for (const [key, value] of form.entries()) if (key !== "username" && key !== "password") params.append(key, value);
    if (!row || !JSON.parse(row.redirect_uris).includes(redirect) || form.get("response_type") !== "code" || form.get("code_challenge_method") !== "S256" || !challenge) return json({ error: "invalid_request" }, 400);
    if (!verifyAdmin(form.get("username") ?? "", form.get("password") ?? "")) return loginPage(params, "Invalid username or password.");
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
export async function verifyOAuthAccessToken(token: string): Promise<{ token: string; clientId: string; scopes: string[]; expiresAt: number; resource: string } | null> {
  const { resourceUrl } = oauthConfig();
  if (!oauthEnabled() || !resourceUrl) return null;
  const row = sqlite.query("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'").get(hash(token)) as any;
  if (!row || row.expires_at < now() || row.resource !== resourceUrl.href) return null;
  return { token, clientId: row.client_id, scopes: JSON.parse(row.scopes), expiresAt: row.expires_at, resource: row.resource };
}
