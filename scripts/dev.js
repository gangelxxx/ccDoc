delete process.env.ELECTRON_RUN_AS_NODE;
require("child_process").execSync("npx electron-vite dev", {
  cwd: require("path").join(__dirname, "..", "packages", "desktop"),
  stdio: "inherit",
});
