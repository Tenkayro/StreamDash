import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**", "**/.dev-data/**", "**/android-companion/**"],
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/services/runtime.tsx",
        "./src/components/Sidebar.tsx",
        "./src/components/TitleBar.tsx",
        "./src/pages/Dashboard.tsx",
      ],
    },
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "zustand",
      "sonner",
      "recharts",
      "lucide-react",
      "date-fns",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
    ],
  },
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("\\react\\") ||
            id.includes("/react/") ||
            id.includes("\\react-dom\\") ||
            id.includes("/react-dom/") ||
            id.includes("scheduler")
          )
            return "react";
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("i18next")) return "i18n";
          if (id.includes("@tauri-apps")) return "tauri";
          if (id.includes("socket.io-client") || id.includes("engine.io-client"))
            return "realtime";
          if (id.includes("date-fns")) return "dates";
          if (id.includes("qrcode")) return "qrcode";
          if (
            id.includes("zustand") ||
            id.includes("sonner") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge") ||
            id.includes("class-variance-authority")
          )
            return "ui-vendor";
        },
      },
    },
  },
})
