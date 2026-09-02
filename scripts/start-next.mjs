import "dotenv/config";

import path from "node:path";
import { spawn } from "node:child_process";

const mode = process.argv[2] || "dev";
const port = String(process.env.PORT || "3000");

const nextCli = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);

const command = mode === "start" ? "start" : "dev";

console.log(`Starting Next.js ${command} on port: ${port}`);

const nextProcess = spawn(process.execPath, [nextCli, command, "-p", port], {
  stdio: "inherit",
  env: process.env,
});

nextProcess.on("error", (error) => {
  console.error("Failed to start Next.js:", error);
  process.exit(1);
});

nextProcess.on("exit", (code) => {
  process.exit(code ?? 0);
});
