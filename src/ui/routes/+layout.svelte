<script lang="ts">
import { onMount, type Snippet } from "svelte"; import "../app.css";
let {children}:{children:Snippet}=$props(); let dark=$state(true);
onMount(()=>{dark=document.documentElement.classList.contains("dark")});
function toggleTheme(){dark=!dark;document.documentElement.classList.toggle("dark",dark);try{localStorage.setItem("toolsmith-theme",dark?"dark":"light")}catch{}}
</script>
<svelte:head><meta name="application-name" content="Toolsmith"/><meta name="theme-color" content={dark?"#0a0a0a":"#fafafa"}/></svelte:head>
<button type="button" class="fixed right-5 top-5 z-20 grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-fg-muted transition hover:bg-surface-hover hover:text-fg" aria-label={dark?"Switch to light mode":"Switch to dark mode"} title={dark?"Switch to light mode":"Switch to dark mode"} onclick={toggleTheme}>
{#if dark}<svg viewBox="0 0 24 24" class="h-[17px] w-[17px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
{:else}<svg viewBox="0 0 24 24" class="h-[17px] w-[17px]" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/></svg>{/if}
</button>
{@render children()}
