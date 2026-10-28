import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Keep local .env values available to server code during development. Production
// values are provided by Cloudflare Worker secrets and bindings.
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// This CRM is connected to the Recette Supabase project. Fix the public browser
// config here so stale Cloudflare build variables cannot point the app elsewhere.
// Both values are public; never put a service-role or secret key in this file.
const supabaseUrl = "https://ljquiweziktbjxldfztk.supabase.co";
const supabasePublishableKey = "sb_publishable_ep3uSXHgzsJr1Q7L80rwYA_lVpre7uZ";

export default defineConfig({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  resolve: {
    alias: {
      "entities/lib/decode.js": path.resolve(rootDir, "node_modules/entities/lib/decode.js"),
      "entities/lib/encode.js": path.resolve(rootDir, "node_modules/entities/lib/encode.js"),
      entities: path.resolve(rootDir, "node_modules/entities"),
    },
  },
});
