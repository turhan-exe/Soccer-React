import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { viteSourceLocator } from "@metagptx/vite-plugin-source-locator";

export default defineConfig(({ mode }) => ({
  plugins: [
    viteSourceLocator({ prefix: "mgx" }),
    react(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // 🔽 Ekle
  build: {
    chunkSizeWarningLimit: 1600, // uyarı eşiğini mantıklı seviyeye çek
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react")) return "vendor-react";
            if (id.includes("firebase")) return "vendor-firebase";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("three")) return "vendor-three";
            return "vendor";
          }
        },
      },
    },
  },
}));
