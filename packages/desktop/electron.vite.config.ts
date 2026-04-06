import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, readdirSync } from "fs";

const fast = process.env.FAST_BUILD === "1";

/** Vite plugin to copy provider script JS files to dist/main */
function copyProviderScripts() {
  return {
    name: "copy-provider-scripts",
    closeBundle() {
      const srcDir = resolve(__dirname, "src/main/services/provider-scripts/builtin");
      const destDir = resolve(__dirname, "dist/main/provider-scripts/builtin");
      try {
        mkdirSync(destDir, { recursive: true });
        for (const file of readdirSync(srcDir).filter(f => f.endsWith(".js"))) {
          copyFileSync(resolve(srcDir, file), resolve(destDir, file));
        }
        console.log("[copy-provider-scripts] copied builtin scripts to dist/main");
      } catch (err) {
        console.warn("[copy-provider-scripts] failed:", err);
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      ...(fast ? [bytecodePlugin()] : []),
      copyProviderScripts(),
    ],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          "semantic-worker": resolve(__dirname, "src/main/semantic-worker.ts"),
          "fts-worker": resolve(__dirname, "src/main/fts-worker.ts"),
          "doc-collector-worker": resolve(__dirname, "src/main/doc-collector-worker.ts"),
        },
        external: ["onnxruntime-node", "onnxruntime-web"],
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
      ...(fast ? [bytecodePlugin()] : []),
    ],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: resolve(__dirname, "src/main/preload.ts"),
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: resolve(__dirname, "dist/renderer"),
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
