import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { viteSourceLocator } from "@metagptx/vite-plugin-source-locator";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const matchControlBaseUrl = String(env.VITE_MATCH_CONTROL_BASE_URL || "").trim().replace(/\/$/, "");

  return {
    plugins: [
      viteSourceLocator({
        prefix: "mgx",
      }),
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: matchControlBaseUrl
      ? {
          proxy: {
            "/__match-control": {
              target: matchControlBaseUrl,
              changeOrigin: true,
              secure: false,
              rewrite: (requestPath) => requestPath.replace(/^\/__match-control/, ""),
            },
          },
        }
      : undefined,
  };
});
