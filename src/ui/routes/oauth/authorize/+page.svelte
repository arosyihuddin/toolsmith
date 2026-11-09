<script lang="ts">
  import { onMount } from "svelte";
  import BrandMark from "../../../lib/components/BrandMark.svelte";

  let params = $state<[string,string][]>([]);
  let error = $state("");
  let showPassword = $state(false);
  let username = $state("");
  let password = $state("");

  onMount(() => {
    const query = new URLSearchParams(window.location.search);
    params = [...query.entries()].filter(([key]) => key !== "error");
    if (query.get("error") === "invalid_credentials") error = "Username atau password salah.";
  });
</script>

<svelte:head><title>Authorize MCP client — Toolsmith</title><meta name="description" content="Authorize an MCP client to connect to Toolsmith."/></svelte:head>

<div class="min-h-screen bg-canvas p-3 text-fg sm:p-5 lg:p-8">
  <main class="mx-auto grid min-h-[calc(100vh-1.5rem)] w-full max-w-6xl overflow-hidden rounded-2xl border border-line bg-surface shadow-card sm:min-h-[calc(100vh-2.5rem)] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-2">
    <section class="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-surface-raised p-10 lg:flex xl:p-14">
      <div class="flex items-center gap-3"><BrandMark size={36}/><span class="text-sm font-semibold tracking-tight">Toolsmith</span></div>
      <div class="my-12 max-w-lg"><p class="mb-4 text-xs font-medium uppercase tracking-[.16em] text-fg-subtle">Secure authorization</p><h1 class="max-w-md text-4xl font-semibold leading-[1.12] tracking-[-.045em] xl:text-[3.25rem]">Connect your<br/>tools.</h1><p class="mt-5 max-w-sm text-sm leading-6 text-fg-subtle">Berikan izin kepada client MCP untuk mengakses instance Toolsmith Anda.</p><div class="mt-12 flex items-center gap-3"><div class="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-accent"><svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3 4.5 7v10L12 21l7.5-4V7L12 3Z"/><path d="m9 12 2 2 4-4"/></svg></div><div class="text-xs text-fg-subtle">Authorization is protected by your administrator credentials.</div></div></div>
      <p class="text-xs text-fg-faint">Toolsmith · OAuth authorization</p>
    </section>
    <section class="flex min-w-0 items-center justify-center px-5 py-12 sm:px-10 lg:px-12 xl:px-16">
      <div class="w-full max-w-[380px]">
        <div class="mb-8 flex items-center gap-3 lg:hidden"><BrandMark size={34}/><span class="text-sm font-semibold tracking-tight">Toolsmith</span></div>
        <div class="mb-8"><p class="mb-3 text-xs font-medium uppercase tracking-[.16em] text-fg-subtle">MCP authorization</p><h2 class="text-2xl font-semibold tracking-tight">Login administrator</h2><p class="mt-2 text-sm leading-6 text-fg-subtle">Masukkan kredensial administrator untuk melanjutkan koneksi.</p></div>
        <form method="POST" action="/oauth/authorize" class="space-y-5">
          {#each params as [key,value]}<input type="hidden" name={key} value={value}/>{/each}
          <div><label for="oauth-username" class="mb-2 block text-sm font-medium">Username</label><input id="oauth-username" name="username" bind:value={username} required autocomplete="username" autocapitalize="none" spellcheck="false" class="w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/10" placeholder="Masukkan username"/></div>
          <div><label for="oauth-password" class="mb-2 block text-sm font-medium">Password</label><div class="flex items-center rounded-lg border border-line bg-surface transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10"><input id="oauth-password" name="password" bind:value={password} required type={showPassword?"text":"password"} autocomplete="current-password" class="min-w-0 flex-1 rounded-lg bg-transparent px-3.5 py-3 text-sm outline-none focus-visible:ring-0" placeholder="Masukkan password"/><button type="button" class="mr-1.5 grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg" aria-label={showPassword?"Sembunyikan password":"Tampilkan password"} onclick={()=>showPassword=!showPassword}><svg viewBox="0 0 24 24" class="h-[18px] w-[18px]" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="2.5"/></svg></button></div></div>
          {#if error}<p class="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm text-danger" role="alert">{error}</p>{/if}
          <button type="submit" class="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-fg transition hover:bg-accent-hover">Authorize connection</button>
        </form>
        <p class="mt-8 border-t border-line pt-5 text-center text-xs text-fg-faint">Secure administrator access</p>
      </div>
    </section>
  </main>
</div>
