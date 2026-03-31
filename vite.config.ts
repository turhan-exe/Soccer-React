import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { viteSourceLocator } from "@metagptx/vite-plugin-source-locator";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const rawMatchControlBaseUrl = (env.VITE_MATCH_CONTROL_BASE_URL || "").trim();

  let matchControlProxy:
    | {
        target: string;
        changeOrigin: boolean;
        rewrite: (requestPath: string) => string;
      }
    | undefined;

  try {
    if (rawMatchControlBaseUrl) {
      const parsed = new URL(rawMatchControlBaseUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        const target = `${parsed.protocol}//${parsed.host}`;
        const basePath = parsed.pathname.replace(/\/$/, "");

        matchControlProxy = {
          target,
          changeOrigin: true,
          rewrite: (requestPath: string) => {
            const strippedPath = requestPath.replace(/^\/__match-control/, "");
            return `${basePath}${strippedPath || "/"}`;
          },
        };
      }
    }
  } catch {
    matchControlProxy = undefined;
  }

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
    server: matchControlProxy
      ? {
          proxy: {
            "/__match-control": matchControlProxy,
          },
        }
      : undefined,
  };
});
