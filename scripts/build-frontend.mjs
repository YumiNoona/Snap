import { spawnSync } from "node:child_process";
const edition = process.argv[2] ?? "full";
if (!["full", "recorder", "editor"].includes(edition)) throw new Error("Unknown Snap edition");
const env = { ...process.env, VITE_SNAP_EDITION: edition };
for (const [file, args] of [["node_modules/typescript/bin/tsc", []], ["node_modules/vite/bin/vite.js", ["build"]]]) {
  const result = spawnSync(process.execPath, [file, ...args], { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
