import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vike from "vike/plugin";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const useCloudflare = process.env.DRAMA_CF === "1";

export default defineConfig({
  plugins: [
    ...(useCloudflare ? [cloudflare({ viteEnvironment: { name: "ssr" } })] : []),
    vike(),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
  },
});
