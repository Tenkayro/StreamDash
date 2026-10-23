import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const versionFiles = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];

function executable(name) {
  return process.platform === "win32" && ["npm", "npx"].includes(name)
    ? `${name}.cmd`
    : name;
}

function quoteArgument(value) {
  return /^[\w\-.\\/:@=,+]+$/.test(value)
    ? value
    : `"${value.replace(/"/g, '""')}"`;
}

function spawnProcess(name, args, options) {
  const command = executable(name);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(quoteArgument).join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(command, args, options);
}

async function run(name, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawnProcess(name, args, {
      cwd: root,
      env: options.env || process.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(`${name} could not be started: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolveRun({ stdout: stdout.trim(), stderr: stderr.trim() });
      const output = `${stdout}\n${stderr}`.trim();
      reject(new Error(`${name} ${args.join(" ")} failed${output ? `:\n${output.slice(-5000)}` : ""}`));
    });
  });
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
  return match?.slice(1).map(Number);
}

function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function cancelled(value) {
  if (!p.isCancel(value)) return;
  p.cancel("Release cancelled. No files were changed.");
  process.exit(0);
}

async function updateVersions(version) {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  packageJson.version = version;
  await writeFile(join(root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  const packageLock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  packageLock.version = version;
  if (packageLock.packages?.[""]) packageLock.packages[""].version = version;
  await writeFile(join(root, "package-lock.json"), `${JSON.stringify(packageLock, null, 2)}\n`);

  const cargoPath = join(root, "src-tauri/Cargo.toml");
  const cargo = await readFile(cargoPath, "utf8");
  await writeFile(cargoPath, cargo.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${version}$2`));

  const tauriPath = join(root, "src-tauri/tauri.conf.json");
  const tauri = JSON.parse(await readFile(tauriPath, "utf8"));
  tauri.version = version;
  await writeFile(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`);
}

async function main() {
  p.intro("StreamDash local release");
  if (process.platform !== "win32") throw new Error("Windows is required for MSI and MSIX builds.");

  const currentVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const bump = await p.select({
    message: `Current version is ${currentVersion}. Choose the next version:`,
    options: [
      { value: "patch", label: `Patch  -> ${bumpVersion(currentVersion, "patch")}` },
      { value: "minor", label: `Minor  -> ${bumpVersion(currentVersion, "minor")}` },
      { value: "major", label: `Major  -> ${bumpVersion(currentVersion, "major")}` },
      { value: "custom", label: "Enter a custom version" },
    ],
  });
  cancelled(bump);

  let version = bump === "custom"
    ? await p.text({
        message: "Version",
        placeholder: currentVersion,
        validate: (value) => parseVersion(value) ? undefined : "Use semantic versioning, for example 1.2.3.",
      })
    : bumpVersion(currentVersion, bump);
  cancelled(version);
  version = (version ?? "").trim();

  const summary = await p.text({
    message: "Short release summary for latest.json",
    defaultValue: `StreamDash ${version} improvements and fixes.`,
    validate: (value) => (value ?? "").trim() ? undefined : "Enter a short release summary.",
  });
  cancelled(summary);

  p.note(
    [
      `${currentVersion}  ->  ${version}`,
      "Outputs: MSI, updater signature, latest.json, Microsoft Store MSIX",
      "No Git commit, tag, push, or GitHub release will be created.",
    ].join("\n"),
    "Local release",
  );
  const confirmed = await p.confirm({ message: `Build local release ${version}?`, initialValue: true });
  cancelled(confirmed);
  if (!confirmed) return p.cancel("Release cancelled. No files were changed.");

  const snapshots = new Map(await Promise.all(
    versionFiles.map(async (file) => [file, await readFile(join(root, file), "utf8")]),
  ));

  try {
    const progress = p.spinner();
    progress.start(`Updating project versions to ${version}`);
    await updateVersions(version);
    progress.message("Running TypeScript and Rust checks");
    await run("npm", ["run", "check"]);
    await run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);

    const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), ".tauri", "streamdash-updater.key");
    progress.message("Building the signed MSI updater package");
    await run("npm", ["run", "setup"], {
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: keyPath },
    });

    progress.message("Packaging the Microsoft Store MSIX without rebuilding");
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", "scripts/build-msix.ps1",
      "-SkipBuild",
    ]);

    const bundleDirectory = join(root, "src-tauri", "target", "release", "bundle", "msi");
    const installerAssetName = "StreamDash-Setup.msi";
    const installerAsset = join(bundleDirectory, installerAssetName);
    const signature = (await readFile(`${installerAsset}.sig`, "utf8")).trim();
    const manifest = {
      version,
      notes: (summary ?? "").trim(),
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/Tenkayro/StreamDash/releases/download/v${version}/${installerAssetName}`,
        },
      },
    };
    await writeFile(join(bundleDirectory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    progress.stop("Local MSI and MSIX release artifacts are ready");
    p.outro(join(root, "src-tauri", "target", "release", "bundle"));
  } catch (error) {
    await Promise.all([...snapshots].map(([file, content]) => writeFile(join(root, file), content)));
    throw error;
  }
}

main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  p.outro("Local release failed. Version files were restored and nothing was uploaded.");
  process.exitCode = 1;
});
