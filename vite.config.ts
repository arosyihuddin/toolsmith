import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({ pages: "dist/ui", assets: "dist/ui", fallback: "200.html", strict: true }),
      files: {
        appTemplate: "src/ui/app.html",
        assets: "src/ui/static",
        routes: "src/ui/routes",
      },
    }),
  ],
});
