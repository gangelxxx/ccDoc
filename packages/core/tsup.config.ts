import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Native modules must stay external
  external: ["onnxruntime-node"],
  // Bundle ESM-only deps so CJS output works in Electron
  noExternal: [
    "fractional-indexing",
    "mdast-util-from-markdown",
    "mdast-util-to-markdown",
    "mdast-util-gfm",
    "micromark-extension-gfm",
    "mdast-util-frontmatter",
    "micromark-extension-frontmatter",
    "minisearch",
    "marked",
    "elkjs",
    "uuid",
  ],
});
