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
let directorProc = null;
let shuttingDown = false;
let pendingCommand = null;
const sseClients = new Set();

const directorState = {
  phase: "starting",
  step: 0,
  totalSteps: 12,
  title: "Launching StreamDash...",
  subtitle: "Preparing isolated demo environment",
  progress: 0,
  paused: false,
  startedAt: null,
  outputFile: OUTPUT_FILE,
  sizeMb: null,
};

function broadcastDirectorState() {
  const payload = `data: ${JSON.stringify(directorState)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

function updateDirectorState(patch) {
  Object.assign(directorState, patch);
  broadcastDirectorState();
}

function openDirectorWindow() {
  if (process.platform !== "win32") return;
  const url = `http://127.0.0.1:${SIGNAL_PORT}/`;
  const edgePaths = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const edgeExe = edgePaths.find((p) => fs.existsSync(p));
  if (edgeExe) {
    directorProc = spawn(
      edgeExe,
      [`--app=${url}`, "--window-size=440,580", "--window-position=40,60"],
      { stdio: "ignore", detached: true },
    );
    directorProc.unref();
    return;
  }
  spawn("cmd", ["/c", "start", "", url], {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  }).unref();
}

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

async function finishRecording(discard = false) {
  if (shuttingDown) return;
  shuttingDown = true;
  updateDirectorState({
    phase: discard ? "cancelled" : "finalizing",
    title: discard ? "Recording cancelled" : "Finalizing capture...",
    subtitle: discard ? "Discarding temporary files" : "Closing raw capture stream",
  });

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

  if (discard) {
    fs.rmSync(RAW_FILE, { force: true });
    server.close();
    console.log("\nDemo recording cancelled.");
    process.exit(0);
  }

  if (fs.existsSync(RAW_FILE)) {
    try {
      updateDirectorState({
        phase: "rendering",
        title: "Rendering 1080p60 Master...",
        subtitle: "Adding intro slate, studio backdrop & outro",
        progress: 100,
      });
      renderStudioMaster();
      fs.rmSync(RAW_FILE, { force: true });
    } catch (err) {
      console.error("Post-processing failed, keeping raw recording:", err);
      fs.renameSync(RAW_FILE, OUTPUT_FILE);
    }
  }

  if (fs.existsSync(OUTPUT_FILE)) {
    const sizeMb = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(2);
    updateDirectorState({
      phase: "saved",
      title: "Demo Video Saved!",
      subtitle: `exports/streamdash-demo.mp4 (${sizeMb} MB)`,
      sizeMb,
    });
    console.log(`\nDemo video ready: ${OUTPUT_FILE} (${sizeMb} MB)`);
    await new Promise((r) => setTimeout(r, 1200));
  } else {
    updateDirectorState({
      phase: "error",
      title: "Export failed",
      subtitle: "Output MP4 was not found.",
    });
    console.error("Recording finished, but output MP4 was not found.");
    process.exitCode = 1;
  }
  server.close();
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

function getDirectorHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>StreamDash Demo Director</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
  body {
    margin: 0; padding: 20px; background: #090b12; color: #f4f4f5;
    display: flex; flex-direction: column; gap: 14px; min-height: 100vh;
  }
  .card {
    background: #121521; border: 1px solid rgba(255,255,255,0.09);
    border-radius: 14px; padding: 16px;
  }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .badge {
    font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px;
    background: rgba(139,92,246,0.18); color: #c4b5fd; text-transform: uppercase; letter-spacing: .04em;
  }
  .badge.rec { background: rgba(239,68,68,0.18); color: #fca5a5; }
  .badge.ok { background: rgba(16,185,129,0.18); color: #6ee7b7; }
  h1 { font-size: 15px; margin: 0; font-weight: 600; }
  .muted { font-size: 12px; color: #9ca3af; margin-top: 4px; }
  .bar { height: 7px; border-radius: 99px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 12px; }
  .fill { height: 100%; width: 0%; background: linear-gradient(90deg, #8b5cf6, #34d399); transition: width .35s ease; }
  .timer { font-family: ui-monospace, monospace; font-size: 12px; color: #a1a1aa; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  button {
    cursor: pointer; border: 1px solid rgba(255,255,255,0.12); background: #191d2d; color: #f4f4f5;
    border-radius: 10px; padding: 10px 12px; font-size: 13px; font-weight: 600; transition: .15s;
  }
  button:hover:not(:disabled) { background: #232940; border-color: rgba(139,92,246,0.5); }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .primary { background: #6d28d9; border-color: #7c3aed; }
  .primary:hover:not(:disabled) { background: #7c3aed; }
  .save { background: #059669; border-color: #10b981; }
  .save:hover:not(:disabled) { background: #10b981; }
  .danger { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.35); color: #fca5a5; }
  .danger:hover:not(:disabled) { background: rgba(239,68,68,0.25); }
</style>
</head>
<body>
  <div class="card">
    <div class="row">
      <h1>StreamDash Demo Director</h1>
      <span id="phaseBadge" class="badge">Starting</span>
    </div>
    <div class="muted" id="subStatus">This window is excluded from recording.</div>
  </div>

  <div class="card">
    <div class="row">
      <span class="badge" id="stepBadge">00 / 12</span>
      <span class="timer" id="timer">00:00</span>
    </div>
    <h1 id="stepTitle" style="margin-top:10px;">Launching StreamDash...</h1>
    <div class="muted" id="stepSub">Preparing isolated demo environment</div>
    <div class="bar"><div class="fill" id="progressFill"></div></div>
  </div>

  <div class="card grid">
    <button id="pauseBtn" onclick="sendAction(isPaused ? 'resume' : 'pause')">Pause Tour</button>
    <button id="restartBtn" onclick="sendAction('restart')">Restart Tour</button>
    <button class="save" id="saveBtn" onclick="sendAction('stop_save')">Stop &amp; Save MP4</button>
    <button class="danger" id="cancelBtn" onclick="sendAction('cancel')">Cancel</button>
  </div>

  <button id="folderBtn" class="primary" onclick="sendAction('open_folder')">Open Exports Folder</button>

<script>
let isPaused = false;
let startedAt = null;

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return m + ':' + r;
}

setInterval(() => {
  if (startedAt && !isPaused) {
    document.getElementById('timer').textContent = fmtTime(Date.now() - startedAt);
  }
}, 250);

async function sendAction(action) {
  await fetch('/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });
}

const es = new EventSource('/events');
es.onmessage = (ev) => {
  const s = JSON.parse(ev.data);
  isPaused = Boolean(s.paused);
  if (s.startedAt && !startedAt) startedAt = s.startedAt;

  const badge = document.getElementById('phaseBadge');
  badge.textContent = s.paused ? 'Paused' : s.phase;
  badge.className = 'badge ' + (s.phase === 'recording' ? 'rec' : (s.phase === 'saved' ? 'ok' : ''));

  document.getElementById('stepBadge').textContent =
    String(s.step || 0).padStart(2, '0') + ' / ' + String(s.totalSteps || 12).padStart(2, '0');
  document.getElementById('stepTitle').textContent = s.title || '';
  document.getElementById('stepSub').textContent = s.subtitle || '';
  document.getElementById('progressFill').style.width = (s.progress || 0) + '%';

  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.textContent = isPaused ? 'Resume Tour' : 'Pause Tour';

  const busy = ['finalizing', 'rendering', 'saved', 'cancelled'].includes(s.phase);
  pauseBtn.disabled = busy;
  document.getElementById('restartBtn').disabled = busy;
  document.getElementById('saveBtn').disabled = busy;
  document.getElementById('cancelBtn').disabled = busy;
};
</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getDirectorHtml());
    return;
  }

  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sseClients.add(res);
    res.write(`data: ${JSON.stringify(directorState)}\n\n`);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (req.method === "GET" && req.url === "/command") {
    const command = pendingCommand;
    pendingCommand = null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ command }));
    return;
  }

  if (req.method === "POST" && req.url === "/status") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      try {
        const patch = JSON.parse(body);
        updateDirectorState(patch);
      } catch {
        // Ignore malformed status
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/action") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      try {
        const { action } = JSON.parse(body);
        if (action === "pause" || action === "resume" || action === "restart") {
          pendingCommand = action;
          if (action === "pause") updateDirectorState({ paused: true });
          if (action === "resume") updateDirectorState({ paused: false });
        } else if (action === "stop_save") {
          pendingCommand = "stop_save";
          setTimeout(() => void finishRecording(false), 300);
        } else if (action === "cancel") {
          void finishRecording(true);
        } else if (action === "open_folder") {
          spawn("explorer.exe", [EXPORT_DIR], { stdio: "ignore", detached: true }).unref();
        }
      } catch {
        // Ignore invalid action
      }
    });
    return;
  }

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
        setTimeout(() => {
          updateDirectorState({ phase: "recording", startedAt: Date.now() });
          startFfmpeg(rect);
        }, 400);
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/done") {
    res.writeHead(204).end();
    setTimeout(() => void finishRecording(false), 400);
    return;
  }
  res.writeHead(404).end();
});

server.listen(SIGNAL_PORT, "127.0.0.1", () => {
  console.log(`Demo signal server listening on http://127.0.0.1:${SIGNAL_PORT}`);
  console.log("Opening Demo Director window & launching StreamDash...");
  openDirectorWindow();

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
