<script lang="ts">
  import { onMount } from "svelte";
  import BrandMark from "../lib/components/BrandMark.svelte";

  type AdminSession = { configured: boolean; authenticated: boolean; username?: string; csrfToken: string };
  let session = $state<AdminSession | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state("");
  let notice = $state("");
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let username = $state("");
  let password = $state("");
  let confirmPassword = $state("");
  let setupToken = $state("");
  let publicUrl = $state("");
  let showPassword = $state(false);
  let showConfirmPassword = $state(false);
  let apiToken = $state("");
  let tokenVisible = $state(false);

  onMount(() => {
    void loadSession();
    return () => { if (toastTimer) clearTimeout(toastTimer); };
  });

  function showToast(message: string) {
    notice = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { notice = ""; }, 3000);
  }

  async function loadSession() {
    loading = true;
    error = "";
    try {
      const response = await fetch("/admin/session", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Tidak dapat memeriksa status autentikasi server.");
      session = result;
    } catch (reason) {
      session = null;
      error = reason instanceof Error ? reason.message : "Server autentikasi tidak tersedia.";
    } finally { loading = false; }
  }

  async function postForm(path: string, values: Record<string, string>) {
    if (!session) return false;
    busy = true;
    error = "";
    notice = "";
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ ...values, _csrf: session.csrfToken })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Permintaan gagal.");
      await loadSession();
      showToast("Berhasil.");
      return true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : "Terjadi kesalahan.";
      return false;
    } finally { busy = false; }
  }

  async function submitSetup(event: SubmitEvent) {
    event.preventDefault();
    if (password !== confirmPassword) { error = "Konfirmasi password tidak cocok."; return; }
    const ok = await postForm("/setup", { setup_token: setupToken, username, password, confirm: confirmPassword, public_url: publicUrl });
    if (ok) { password = ""; confirmPassword = ""; setupToken = ""; }
  }

  async function submitLogin(event: SubmitEvent) {
    event.preventDefault();
    const ok = await postForm("/admin/login", { username, password });
    if (ok) password = "";
  }

  async function loadToken() {
    error = "";
    try {
      const response = await fetch("/admin/token", { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal mengambil API token.");
      apiToken = result.token;
      tokenVisible = true;
    } catch (reason) { error = reason instanceof Error ? reason.message : "Terjadi kesalahan."; }
  }

  async function rotateToken() {
    if (!session) return;
    busy = true; error = ""; notice = "";
    try {
      const response = await fetch("/admin/token", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ _csrf: session.csrfToken })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Gagal membuat token baru.");
      apiToken = result.token; tokenVisible = true; showToast("API token baru berhasil dibuat. Simpan sekarang.");
    } catch (reason) { error = reason instanceof Error ? reason.message : "Terjadi kesalahan."; }
    finally { busy = false; }
  }

  async function logout() {
    const ok = await postForm("/admin/logout", {});
    if (ok) { apiToken = ""; tokenVisible = false; showToast("Anda telah logout."); }
  }

  async function copyToken() {
    if (!apiToken) return;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(apiToken);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = apiToken;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        textarea.remove();
        if (!copied) throw new Error("copy_failed");
      }
      error = "";
      showToast("API token disalin.");
    } catch {
      error = "Gagal menyalin token. Browser mungkin memblokir akses clipboard.";
    }
  }
</script>

<svelte:head>
  <title>Toolsmith — Secure MCP Server</title>
  <meta name="description" content="Manage your Toolsmith MCP server securely." />
</svelte:head>

<div class="min-h-screen bg-canvas p-3 text-fg sm:p-5 lg:p-8">
  <main class="mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-2">
    <section class="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface-raised p-10 lg:flex xl:p-14">
      <div class="relative z-10 flex items-center gap-3">
        <BrandMark size={36} />
        <span class="text-sm font-semibold tracking-tight">Toolsmith</span>
      </div>

      <div class="relative z-10 my-12 max-w-lg">
        <p class="mb-4 text-xs font-medium uppercase tracking-[0.16em] text-fg-subtle">Secure · Extensible · MCP-native</p>
        <h1 class="max-w-md text-4xl font-semibold leading-[1.12] tracking-[-0.045em] xl:text-[3.25rem]">Your MCP server,<br />under control.</h1>
        <p class="mt-5 max-w-sm text-sm leading-6 text-fg-subtle">Satu tempat untuk mengamankan server, mengelola akses tools, dan menghubungkan client MCP.</p>

        <div class="mt-12 flex max-w-sm items-center gap-3" aria-hidden="true">
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-fg-muted">
            <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z"/><path d="m4.5 7 7.5 4 7.5-4M12 11v10"/></svg>
          </div>
          <div class="h-px flex-1 bg-line-strong"></div>
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-fg-muted">
            <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="m8 9 3 3-3 3m5 0h3"/></svg>
          </div>
          <div class="h-px flex-1 bg-line-strong"></div>
          <div class="grid h-10 w-10 place-items-center rounded-xl border border-accent/30 bg-accent/5 text-accent">
            <svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
          </div>
        </div>
        <div class="ml-5 mt-3 h-7 w-px bg-line"></div>
        <div class="ml-5 flex items-center gap-2 text-xs text-fg-subtle"><span class="h-1.5 w-1.5 rounded-full bg-success"></span>Secure access · Tools · Workflows</div>
      </div>
      <p class="relative z-10 text-xs text-fg-faint">Toolsmith · Self-hosted MCP server</p>
      <div class="pointer-events-none absolute -bottom-36 -left-28 h-80 w-80 rounded-full border border-line opacity-60"></div>
      <div class="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full border border-line opacity-60"></div>
    </section>

    <section class="flex min-w-0 items-center justify-center px-5 py-12 sm:px-10 lg:px-12 xl:px-16">
      <div class="w-full max-w-[380px]">
        <div class="mb-8 flex items-center gap-3 lg:hidden"><BrandMark size={34}/><span class="text-sm font-semibold tracking-tight">Toolsmith</span></div>
        {#if loading}
          <div class="space-y-4">
            <div class="h-7 w-48 animate-pulse rounded-md bg-surface-active"></div>
            <div class="h-4 w-64 animate-pulse rounded-md bg-surface-active"></div>
            <div class="mt-8 h-11 animate-pulse rounded-lg bg-surface-active"></div>
            <div class="h-11 animate-pulse rounded-lg bg-surface-active"></div>
          </div>
        {:else if !session}
          <h2 class="text-2xl font-semibold tracking-tight">Server tidak tersedia</h2>
          <p class="mt-2 text-sm leading-6 text-fg-subtle">Tidak dapat memeriksa status autentikasi Toolsmith.</p>
          <button class="mt-6 w-full rounded-lg border border-line px-4 py-3 text-sm transition hover:bg-surface-hover" onclick={loadSession}>Coba lagi</button>
        {:else if !session.configured}
          <div class="mb-8">
            <p class="mb-3 text-xs font-medium uppercase tracking-[.16em] text-fg-subtle">Initial setup</p>
            <h2 class="text-2xl font-semibold tracking-tight">Buat akun administrator</h2>
            <p class="mt-2 text-sm leading-6 text-fg-subtle">Buat akun untuk mulai mengamankan instance Toolsmith Anda.</p>
          </div>
          <form onsubmit={submitSetup} class="space-y-5">
            <div><label class="mb-2 block text-sm font-medium" for="setup-token">Setup token</label><input id="setup-token" bind:value={setupToken} required autocomplete="off" spellcheck="false" class="auth-input w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" placeholder="Token dari toolsmith setup-token"/></div>
            <div><label class="mb-2 block text-sm font-medium" for="setup-username">Username</label><input id="setup-username" bind:value={username} required minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+" autocomplete="username" autocapitalize="none" spellcheck="false" class="auth-input w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" placeholder="Masukkan username"/></div>
            <div><label class="mb-2 block text-sm font-medium" for="setup-password">Password</label><div class="flex items-center rounded-lg border border-line bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"><input id="setup-password" bind:value={password} required minlength="8" maxlength="1024" type={showPassword?"text":"password"} autocomplete="new-password" class="min-w-0 flex-1 rounded-lg bg-transparent px-3.5 py-3 text-sm outline-none focus-visible:ring-0" placeholder="Minimal 8 karakter"/><button type="button" class="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg" aria-label={showPassword?"Sembunyikan password":"Tampilkan password"} onclick={()=>showPassword=!showPassword}><svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></div></div>
            <div><label class="mb-2 block text-sm font-medium" for="setup-confirm">Konfirmasi password</label><div class="flex items-center rounded-lg border border-line bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"><input id="setup-confirm" bind:value={confirmPassword} required minlength="8" maxlength="1024" type={showConfirmPassword?"text":"password"} autocomplete="new-password" class="min-w-0 flex-1 rounded-lg bg-transparent px-3.5 py-3 text-sm outline-none focus-visible:ring-0" placeholder="Ulangi password"/><button type="button" class="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg" aria-label={showConfirmPassword?"Sembunyikan password":"Tampilkan password"} onclick={()=>showConfirmPassword=!showConfirmPassword}><svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></div><p class="mt-2 text-xs text-fg-subtle">Password minimal 8 karakter. Akun pertama hanya dapat dibuat sekali.</p></div>
            <div><label class="mb-2 block text-sm font-medium" for="public-url">Public URL <span class="font-normal text-fg-subtle">(opsional)</span></label><input id="public-url" bind:value={publicUrl} type="url" class="auth-input w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" placeholder="https://mcp.example.com"/></div>
            {#if error}<p class="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>{/if}
            <button type="submit" disabled={busy} class="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-55">{busy?"Menyimpan...":"Buat akun administrator"}</button>
          </form>
        {:else if !session.authenticated}
          <div class="mb-8">
            <p class="mb-3 text-xs font-medium uppercase tracking-[.16em] text-fg-subtle">Administrator access</p>
            <h2 class="text-2xl font-semibold tracking-tight">Selamat datang kembali</h2>
            <p class="mt-2 text-sm leading-6 text-fg-subtle">Masuk menggunakan akun administrator Toolsmith Anda.</p>
          </div>
          <form onsubmit={submitLogin} class="space-y-5">
            <div><label class="mb-2 block text-sm font-medium" for="login-username">Username</label><input id="login-username" bind:value={username} required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" class="auth-input w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" placeholder="Masukkan username"/></div>
            <div><label class="mb-2 block text-sm font-medium" for="login-password">Password</label><div class="flex items-center rounded-lg border border-line bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"><input id="login-password" bind:value={password} required maxlength="1024" type={showPassword?"text":"password"} autocomplete="current-password" class="min-w-0 flex-1 rounded-lg bg-transparent px-3.5 py-3 text-sm outline-none focus-visible:ring-0" placeholder="Masukkan password"/><button type="button" class="mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg" aria-label={showPassword?"Sembunyikan password":"Tampilkan password"} onclick={()=>showPassword=!showPassword}><svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></div></div>
            {#if error}<p class="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>{/if}
            <button type="submit" disabled={busy} class="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition hover:bg-accent-hover disabled:cursor-wait disabled:opacity-55">{busy?"Memverifikasi...":"Masuk"}</button>
          </form>
        {:else}
          <div class="mb-8">
            <p class="mb-3 text-xs font-medium uppercase tracking-[.16em] text-fg-subtle">Server settings</p>
            <h2 class="text-2xl font-semibold tracking-tight">Toolsmith siap digunakan</h2>
            <p class="mt-2 text-sm leading-6 text-fg-subtle">Administrator: <span class="font-medium text-fg">{session.username}</span></p>
          </div>
          <div class="rounded-xl border border-line bg-surface-raised p-4">
            <div class="flex items-center justify-between gap-3"><div><h3 class="text-sm font-semibold">API token</h3><p class="mt-1 text-xs text-fg-subtle">Token autentikasi untuk koneksi MCP.</p></div><button class="rounded-md border border-line px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-surface-hover hover:text-fg" onclick={loadToken}>Tampilkan</button></div>
            {#if tokenVisible}<div class="mt-4 break-all rounded-lg border border-line bg-canvas p-3 font-mono text-xs text-fg-muted">{apiToken}</div><div class="mt-3 flex flex-wrap gap-2"><button class="rounded-md border border-line px-3 py-2 text-xs font-medium transition hover:bg-surface-hover" onclick={copyToken}>Copy token</button><button class="rounded-md border border-line px-3 py-2 text-xs font-medium transition hover:bg-surface-hover disabled:opacity-50" onclick={rotateToken} disabled={busy}>Generate baru</button></div>{/if}
          </div>
          {#if error}<p class="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>{/if}
          <button class="mt-6 w-full rounded-lg border border-line px-4 py-2.5 text-sm transition hover:bg-surface-hover" onclick={logout} disabled={busy}>Logout</button>
        {/if}
        {#if notice}<div class="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-xl border border-success/20 bg-surface-raised px-4 py-3 text-sm text-fg shadow-card" role="status" aria-live="polite"><span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success/10 text-success">✓</span><span>{notice}</span></div>{/if}
        <p class="mt-8 border-t border-line pt-5 text-center text-xs text-fg-faint">Secure administrator access</p>
      </div>
    </section>
  </main>
</div>
