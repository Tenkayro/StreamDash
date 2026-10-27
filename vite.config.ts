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
      ignored: ["**/src-tauri/target/**"],
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
})
