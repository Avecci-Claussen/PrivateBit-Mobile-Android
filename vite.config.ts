import { defineConfig } from "vite";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

// The web part of the app: the extension's shared source plus the Android shell in web/.
export default defineConfig(({ mode }) => {
  if (mode === "private" && !(process.env.UNISAT_API_KEY ?? "").trim()) throw new Error("private build needs UNISAT_API_KEY in the environment");
  return {
  root: __dirname,
  base: "./",
  publicDir: resolve(__dirname, "shared/public"),
  define: { __PB_PRIVATE_UNISAT__: mode === "private" ? JSON.stringify((process.env.UNISAT_API_KEY ?? "").trim()) : "undefined" },
  envPrefix: "PRIVATEBIT_BUILD_NEVER_",
  resolve: { preserveSymlinks: false },
  plugins: [
    {
      name: "dapp-inject",
      closeBundle() {
        const out = resolve(__dirname, mode === "e2e" ? "www-e2e" : mode === "private" ? "www-private" : "www");
        buildSync({ entryPoints: [resolve(__dirname, "web/dapp-inject.ts")], outfile: resolve(out, "dapp-inject.js"), bundle: true, format: "iife", target: "chrome111", minify: true, legalComments: "none" });
      },
    },
  ],
  build: {
    outDir: mode === "e2e" ? "www-e2e" : mode === "private" ? "www-private" : "www",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: { index: resolve(__dirname, "index.html") },
      output: { entryFileNames: "assets/[name]-[hash].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
};
});
