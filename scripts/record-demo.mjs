import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const DEMO_DATA_DIR = path.join(ROOT, ".dev-data", "demo");
const EXPORT_DIR = path.join(ROOT, "exports");
const OUTPUT_FILE = path.join(EXPORT_DIR, "streamdash-demo.mp4");
const CAPTURE_SCRIPT = path.join(ROOT, "scripts", "capture-window.ps1");
const SIGNAL_PORT = 1429;

fs.rmSync(DEMO_DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

let tauriProc = null;
let captureProc = null;
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
    if (captureProc) {
      try {
        captureProc.stdout?.unpipe(ffmpegProc.stdin);
      } catch {
        // Ignore unpipe error
      }
      if (captureProc.pid) {
        killTree(captureProc.pid);
      }
      try {
        ffmpegProc.stdin.end();
      } catch {
        ffmpegProc.kill("SIGINT");
      }
    } else {
      try {
        ffmpegProc.stdin.write("q\n");
      } catch {
        ffmpegProc.kill("SIGINT");
      }
    }
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 6000);
      ffmpegProc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  if (captureProc?.pid) {
    killTree(captureProc.pid);
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

function queryStreamDashWindowSize() {
  if (process.platform !== "win32") return null;
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        CAPTURE_SCRIPT,
        "-ProcessName",
        "streamdash",
        "-QuerySize",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const match = /^(\d+)x(\d+)$/.exec(out);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width >= 320 && height >= 240) return { width, height };
  } catch {
    // Fall back to gdigrab if window query fails
  }
  return null;
}

function startFfmpeg(rect) {
  const winSize = queryStreamDashWindowSize();
  if (winSize) {
    console.log(
      `Starting PrintWindow 60fps capture of StreamDash HWND (${winSize.width}x${winSize.height})...`,
    );
    captureProc = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        CAPTURE_SCRIPT,
        "-ProcessName",
        "streamdash",
        "-Width",
        String(winSize.width),
        "-Height",
        String(winSize.height),
        "-Fps",
        "60",
      ],
      {
        stdio: ["ignore", "pipe", "inherit"],
        windowsHide: true,
      },
    );

    const args = [
      "-y",
      "-f",
      "rawvideo",
      "-pixel_format",
      "bgra",
      "-video_size",
      `${winSize.width}x${winSize.height}`,
      "-use_wallclock_as_timestamps",
      "1",
      "-i",
      "pipe:0",
      "-vf",
      "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
    ];

    ffmpegProc = spawn("ffmpeg", args, {
      stdio: ["pipe", "inherit", "inherit"],
      windowsHide: true,
    });

    captureProc.stdout.pipe(ffmpegProc.stdin);
    captureProc.on("error", (err) => {
      console.error("Failed to start window capture:", err.message);
      void finishRecording();
    });
    ffmpegProc.on("error", (err) => {
      console.error("Failed to start ffmpeg:", err.message);
      void finishRecording();
    });
    return;
  }

  const args = ["-y", "-f", "gdigrab", "-framerate", "60", "-draw_mouse", "0"];

  if (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    rect.width >= 320 &&
    rect.height >= 240
  ) {
    const w = Math.floor(rect.width / 2) * 2;
    const h = Math.floor(rect.height / 2) * 2;
    args.push(
      "-offset_x",
      String(rect.x),
      "-offset_y",
      String(rect.y),
      "-video_size",
      `${w}x${h}`,
      "-i",
      "desktop",
    );
    console.log(
      `Starting FFmpeg 60fps desktop capture at (${rect.x},${rect.y}) ${w}x${h}...`,
    );
  } else {
    args.push("-i", "desktop");
    console.log("Starting FFmpeg 60fps desktop capture...");
  }

  args.push(
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
  );

  ffmpegProc = spawn("ffmpeg", args, {
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
  });

  ffmpegProc.on("error", (err) => {
    console.error("Failed to start ffmpeg:", err.message);
    void finishRecording();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/ready") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(204).end();
      if (!ffmpegProc) {
        let rect = null;
        try {
          rect = body ? JSON.parse(body) : null;
        } catch {
          rect = null;
        }
        setTimeout(() => startFfmpeg(rect), 400);
      }
    });
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
      STREAMDASH_DATA_DIR: DEMO_DATA_DIR,
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
