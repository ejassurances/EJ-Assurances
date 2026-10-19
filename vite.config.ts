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

// Supabase's publishable key is designed to be exposed in browser applications.
// These defaults keep the CRM login connected when Cloudflare's build variables
// have not been configured; environment values still override them.
const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://ljquiweziktbjxldfztk.supabase.co";
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_ep3uSXHgzsJr1Q7L80rwYA_lVpre7uZ";

export default defineConfig({
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
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
