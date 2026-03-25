import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin, bytecodePlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const fast = process.env.FAST_BUILD === "1";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      ...(fast ? [bytecodePlugin()] : []),
    ],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
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
