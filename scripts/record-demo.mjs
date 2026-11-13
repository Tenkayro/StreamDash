import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const DEMO_DATA_DIR = path.join(ROOT, ".dev-data", "demo");
const EXPORT_DIR = path.join(ROOT, "exports");
const RAW_FILE = path.join(EXPORT_DIR, ".raw-demo.mp4");
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

function getVideoDuration(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const sec = Number.parseFloat(out);
    return Number.isFinite(sec) && sec > 1 ? sec : 40;
  } catch {
    return 40;
  }
}

function renderStudioMaster() {
  const duration = getVideoDuration(RAW_FILE);
  const introDur = 2.2;
  const outroDur = 2.4;
  const fadeDur = 0.45;
  const mainFadeOffset = Math.max(0.5, Number((introDur - fadeDur).toFixed(2)));
  const outroFadeOffset = Math.max(
    mainFadeOffset + 1,
    Number((mainFadeOffset + duration - fadeDur).toFixed(2)),
  );
  const totalCanvasDur = Number((duration + 0.5).toFixed(2));
  const fontBold = "C\\:/Windows/Fonts/seguisb.ttf";
  const fontReg = "C\\:/Windows/Fonts/segoeui.ttf";

  const filterComplex = [
    `gradients=s=1920x1080:c0=#070911:c1=#17112e:c2=#0a1726:c3=#070911:speed=0.0018:duration=${introDur}:rate=60,` +
      `drawtext=fontfile='${fontBold}':text='StreamDash 2.1':fontcolor=white:fontsize=76:x=(w-text_w)/2:y=(h-text_h)/2-28,` +
      `drawtext=fontfile='${fontReg}':text='All-in-One Live Stream Control':fontcolor=#a78bfa:fontsize=30:x=(w-text_w)/2:y=(h-text_h)/2+46,` +
      `fade=t=in:st=0:d=0.45[intro]`,

    `gradients=s=1920x1080:c0=#070911:c1=#130f26:c2=#091320:c3=#070911:speed=0.0012:duration=${totalCanvasDur}:rate=60[bg]`,
    `[0:v]fps=60,scale=1640:-2:flags=lanczos,pad=iw+4:ih+4:2:2:color=#27273a@0.9[win]`,
    `[bg][win]overlay=(W-w)/2:(H-h)/2:shortest=1[stage]`,

    `gradients=s=1920x1080:c0=#070911:c1=#17112e:c2=#0a1726:c3=#070911:speed=0.0018:duration=${outroDur}:rate=60,` +
      `drawtext=fontfile='${fontBold}':text='StreamDash 2.1':fontcolor=white:fontsize=68:x=(w-text_w)/2:y=(h-text_h)/2-28,` +
      `drawtext=fontfile='${fontReg}':text='Fast. Local. Built for Streamers.':fontcolor=#34d399:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2+44,` +
      `fade=t=out:st=${(outroDur - 0.55).toFixed(2)}:d=0.55[outro]`,

    `[intro][stage]xfade=transition=fade:duration=${fadeDur}:offset=${mainFadeOffset}[part1]`,
    `[part1][outro]xfade=transition=fade:duration=${fadeDur}:offset=${outroFadeOffset},format=yuv420p[vout]`,
  ].join(";");

  console.log("Rendering 1080p60 Screen-Studio master video (intro + backdrop + outro)...");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      RAW_FILE,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
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
    { stdio: "inherit", windowsHide: true },
  );
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

  if (fs.existsSync(RAW_FILE)) {
    try {
      renderStudioMaster();
      fs.rmSync(RAW_FILE, { force: true });
    } catch (err) {
      console.error("Post-processing failed, keeping raw recording:", err);
      fs.renameSync(RAW_FILE, OUTPUT_FILE);
    }
  }

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
      "veryfast",
      "-crf",
      "12",
      "-pix_fmt",
      "yuv420p",
      RAW_FILE,
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
    "veryfast",
    "-crf",
    "12",
    "-pix_fmt",
    "yuv420p",
    RAW_FILE,
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
