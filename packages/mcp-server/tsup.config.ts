import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    clean: true,
    banner: { js: [
      "#!/usr/bin/env node",
      "// Ensure native modules (libsql) are resolvable regardless of cwd",
      "var __p = require('path'), __m = require('module'), __fs = require('fs');",
      "var __root = __p.resolve(__dirname, '..', '..', '..');",
      "// Find libsql in pnpm virtual store (pnpm doesn't hoist to root node_modules)",
      "var __pnpmLibsql = __p.join(__root, 'node_modules', '.pnpm');",
      "var __libsqlDir = __fs.existsSync(__pnpmLibsql) ? __fs.readdirSync(__pnpmLibsql).find(function(d){return d.startsWith('libsql@')}) : null;",
      "var __paths = [__p.join(__root, 'node_modules')];",
      "if (__libsqlDir) __paths.push(__p.join(__pnpmLibsql, __libsqlDir, 'node_modules'));",
      "process.env.NODE_PATH = [process.env.NODE_PATH].concat(__paths).filter(Boolean).join(__p.delimiter);",
      "__m.Module._initPaths();",
    ].join("\n") },
    noExternal: [/^(?!onnxruntime-node|libsql|@libsql).*/],
  },
  {
    entry: ["src/install.ts"],
    format: ["cjs"],
    outDir: "dist",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
