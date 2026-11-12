import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "streamdash-temp-"));
const webviewDir = path.join(tempRoot, "webview2");
fs.mkdirSync(webviewDir, { recursive: true });

console.log(`[start2] Using temporary profile directory: ${tempRoot}`);

const isWindows = process.platform === "win32";
const child = spawn(
  isWindows ? "npm.cmd" : "npm",
  ["run", "start"],
  {
    stdio: "inherit",
    shell: isWindows,
    env: {
      ...process.env,
      STREAMDASH_DATA_DIR: tempRoot,
      WEBVIEW2_USER_DATA_FOLDER: webviewDir,
    },
  }
);

function cleanup() {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Ignore locked files on Windows exit; OS temp cleans up eventually.
  }
}

process.on("SIGINT", () => {
  child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});

child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
