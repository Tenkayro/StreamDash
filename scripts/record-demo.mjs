import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const EXPORT_DIR = path.join(ROOT, "exports");
const OUTPUT_FILE = path.join(EXPORT_DIR, "streamdash-demo.mp4");
const SIGNAL_PORT = 1429;

fs.mkdirSync(EXPORT_DIR, { recursive: true });

let tauriProc = null;
let ffmpegProc = null;
let shuttingDown = false;

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // Ignore already exited
    }
  }
}

async function finishRecording() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (ffmpegProc && !ffmpegProc.killed) {
    console.log("Finalizing MP4 recording...");
    try {
      ffmpegProc.stdin.write("q\n");
    } catch {
      ffmpegProc.kill("SIGINT");
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 6000);
      ffmpegProc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  if (tauriProc?.pid) {
    killTree(tauriProc.pid);
  }
  server.close();

  if (fs.existsSync(OUTPUT_FILE)) {
    const sizeMb = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(2);
    console.log(`\nDemo video ready: ${OUTPUT_FILE} (${sizeMb} MB)`);
  } else {
    console.error("Recording finished, but output MP4 was not found.");
    process.exitCode = 1;
  }
  process.exit();
}

function startFfmpeg() {
  console.log("Starting FFmpeg 60fps capture of StreamDash window...");
  ffmpegProc = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "gdigrab",
      "-framerate",
      "60",
      "-draw_mouse",
      "0",
      "-i",
      "title=StreamDash",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "16",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      OUTPUT_FILE,
    ],
    { stdio: ["pipe", "inherit", "inherit"], windowsHide: true },
  );

  ffmpegProc.on("error", (err) => {
    console.error("Failed to start ffmpeg:", err.message);
    void finishRecording();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/ready") {
    res.writeHead(204).end();
    if (!ffmpegProc) {
      setTimeout(startFfmpeg, 400);
    }
    return;
  }
  if (req.method === "POST" && req.url === "/done") {
    res.writeHead(204).end();
    setTimeout(() => void finishRecording(), 400);
    return;
  }
  res.writeHead(404).end();
});

server.listen(SIGNAL_PORT, "127.0.0.1", () => {
  console.log(`Demo signal server listening on http://127.0.0.1:${SIGNAL_PORT}`);
  console.log("Launching StreamDash in automated demo mode...");

  const npmCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  tauriProc = spawn(npmCmd, ["tauri", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_DEMO_AUTO: "1",
      STREAMDASH_DATA_DIR: path.join(ROOT, ".dev-data", "demo"),
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  tauriProc.on("exit", () => {
    if (!shuttingDown) {
      void finishRecording();
    }
  });
});

process.on("SIGINT", () => {
  void finishRecording();
});

// Safety timeout (2 minutes max)
setTimeout(() => {
  console.warn("Demo recording safety timeout reached.");
  void finishRecording();
}, 120_000);
