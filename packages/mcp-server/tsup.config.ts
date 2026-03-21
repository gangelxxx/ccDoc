import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    noExternal: [/^(?!onnxruntime-node).*/],
  },
  {
    entry: ["src/install.ts"],
    format: ["cjs"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
