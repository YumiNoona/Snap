import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Pre-bundle these on dev-server startup so secondary webview windows
  // (editor, teleprompter) don't experience a mid-session "new dependencies
  // optimized... reloading" delay that races with their first page load.
  optimizeDeps: {
    include: ["react", "react-dom", "lucide-react", "lucide", "morphicons/react"],
  },
}));
