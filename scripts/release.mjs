import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const repo = "Tenkayro/StreamDash";
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (options.stream) process.stderr.write(chunk);
    });
    child.on("error", (error) => reject(new Error(`${name} could not be started: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure)
        return resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      const output = `${stdout}\n${stderr}`.trim();
      reject(new Error(`${name} ${args.join(" ")} failed${output ? `:\n${output.slice(-5000)}` : ""}`));
    });
  });
}

function releaseStatus(percent, message) {
  p.log.step(`${String(percent).padStart(3)}% · ${message}`);
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
  p.intro("StreamDash Release");
  if (process.platform !== "win32") throw new Error("Windows is required for MSI and MSIX builds.");

  const check = p.spinner();
  check.start("Checking Git, GitHub, and updater signing configuration");
  let keyPath;
  let pendingChanges = "";
  try {
    const [status, , remote, branch] = await Promise.all([
      run("git", ["status", "--porcelain"]),
      run("gh", ["auth", "status"]),
      run("git", ["remote", "get-url", "origin"]),
      run("git", ["branch", "--show-current"]),
    ]);
    pendingChanges = status.stdout;
    if (!remote.stdout.toLowerCase().includes("tenkayro/streamdash"))
      throw new Error(`origin does not point to ${repo}.`);
    if (branch.stdout !== "main")
      throw new Error("Releases must be created from the main branch.");

    keyPath =
      process.env.TAURI_SIGNING_PRIVATE_KEY ||
      join(homedir(), ".tauri", "streamdash-updater.key");
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
    const tauriConfig = JSON.parse(
      await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    if (tauriConfig.plugins?.updater?.pubkey !== publicKey)
      throw new Error(
        "The configured updater public key does not match the local signing key.",
      );
    check.stop("Release environment is ready");
  } catch (error) {
    check.stop("Release environment check failed");
    throw error;
  }

  const currentVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const headPackage = await run("git", ["show", "HEAD:package.json"]);
  const headVersion = JSON.parse(headPackage.stdout).version;
  const hasUnreleasedWorkingVersion = currentVersion !== headVersion;
  const bump = await p.select({
    message: `Current version is ${currentVersion}. Choose the next version:`,
    options: [
      ...(hasUnreleasedWorkingVersion
        ? [
            {
              value: "current",
              label: `Publish current working version ${currentVersion}`,
              hint: `HEAD is still ${headVersion}`,
            },
          ]
        : []),
      { value: "patch", label: `Patch  -> ${bumpVersion(currentVersion, "patch")}` },
      { value: "minor", label: `Minor  -> ${bumpVersion(currentVersion, "minor")}` },
      { value: "major", label: `Major  -> ${bumpVersion(currentVersion, "major")}` },
      { value: "custom", label: "Enter a custom version" },
    ],
  });
  cancelled(bump);
  let version =
    bump === "current"
      ? currentVersion
      : bump === "custom"
        ? await p.text({
            message: "Version",
            placeholder: currentVersion,
            validate: (value) =>
              parseVersion(value)
                ? undefined
                : "Use semantic versioning, for example 1.2.3.",
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

  let changesCommitMessage = "";
  if (pendingChanges) {
    p.note(pendingChanges, "Changes that will be included");
    const includeChanges = await p.confirm({
      message: "Commit these pending changes before creating the version commit?",
      initialValue: true,
    });
    cancelled(includeChanges);
    if (!includeChanges) {
      p.cancel(
        "Release cancelled. Commit or stash the changes you do not want to publish.",
      );
      return;
    }
    changesCommitMessage = await p.text({
      message: "Commit message for the pending changes",
      defaultValue:
        bump === "current"
          ? `chore: release v${version}`
          : "feat: prepare StreamDash release",
      validate: (value) =>
        (value ?? "").trim() ? undefined : "Enter a commit message.",
    });
    cancelled(changesCommitMessage);
  }

  const tag = `v${version}`;
  const [existingTag, existingRelease] = await Promise.all([
    run(
      "git",
      ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
      { allowFailure: true },
    ),
    run(
      "gh",
      ["release", "view", tag, "--repo", repo],
      { allowFailure: true },
    ),
  ]);
  if (existingTag.code === 0) throw new Error(`Tag ${tag} already exists.`);
  if (existingRelease.code === 0)
    throw new Error(`GitHub release ${tag} already exists.`);

  p.note(
    [
      `${currentVersion}  ->  ${version}`,
      "Channel: Stable",
      `Repository: ${repo}`,
      "GitHub: MSI installer, updater signature, latest.json",
      "Local only: Microsoft Store MSIX (never uploaded to GitHub)",
      "GitHub release notes: generated automatically",
    ].join("\n"),
    "Release summary",
  );
  const confirmed = await p.confirm({
    message: `Build, commit${pendingChanges ? " pending changes" : ""}, tag, push, and publish ${tag}?`,
    initialValue: true,
  });
  cancelled(confirmed);
  if (!confirmed) return p.cancel("Release cancelled. No files were changed.");

  if (pendingChanges) {
    const save = p.spinner();
    save.start("Committing the approved pending changes");
    await run("git", ["add", "--all"]);
    await run("git", ["commit", "-m", (changesCommitMessage ?? "").trim()]);
    save.stop("Pending changes committed");
  }

  const releaseFiles = versionFiles;
  const snapshots = new Map(await Promise.all(
    releaseFiles.map(async (file) => [
      file,
      await readFile(join(root, file), "utf8").catch(() => null),
    ]),
  ));

  let committed = false;
  try {
    const progress = p.spinner();
    releaseStatus(5, "Preparing release files");
    progress.start(`Updating project versions to ${version}`);
    await updateVersions(version);
    progress.message("Validating the application");
    const [, sccache] = await Promise.all([
      run("npm", ["run", "lint"]),
      run("sccache", ["--version"], { allowFailure: true }).catch(() => ({
        code: 1,
      })),
    ]);
    const buildEnvironment = {
      ...process.env,
      ...(sccache.code === 0 && !process.env.RUSTC_WRAPPER
        ? { RUSTC_WRAPPER: "sccache" }
        : {}),
      TAURI_SIGNING_PRIVATE_KEY: keyPath,
      CARGO_TERM_PROGRESS_WHEN:
        process.env.CARGO_TERM_PROGRESS_WHEN || "always",
      CARGO_TERM_PROGRESS_WIDTH:
        process.env.CARGO_TERM_PROGRESS_WIDTH || "80",
    };

    const installerAssetName = "StreamDash-Setup.msi";
    progress.stop("Validation complete");
    releaseStatus(
      20,
      "Building the signed MSI updater package",
    );
    const setupArguments = ["run", "setup"];
    await run("npm", setupArguments, {
      env: buildEnvironment,
      stream: true,
    });
    releaseStatus(70, "MSI build and updater signature complete");

    releaseStatus(
      75,
      "Packaging the Microsoft Store MSIX without rebuilding",
    );
    await run(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "scripts/build-msix.ps1",
        "-SkipBuild",
      ],
      { stream: true },
    );

    releaseStatus(82, "Creating the update manifest");
    const bundleDirectory = join(root, "src-tauri", "target", "release", "bundle", "msi");
    const installerAsset = join(bundleDirectory, installerAssetName);
    const signatureAsset = `${installerAsset}.sig`;
    const signature = (await readFile(signatureAsset, "utf8")).trim();
    const manifest = {
      version,
      notes: (summary ?? "").trim(),
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          url: `https://github.com/${repo}/releases/download/${tag}/${installerAssetName}`,
        },
      },
    };
    const manifestPath = join(bundleDirectory, "latest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    releaseStatus(
      86,
      "GitHub artifacts and local Store MSIX are ready",
    );

    releaseStatus(
      88,
      "Committing the release version",
    );
    await run("git", ["add", ...releaseFiles]);
    const stagedVersionChanges = await run(
      "git",
      ["diff", "--cached", "--quiet", "--", ...releaseFiles],
      { allowFailure: true },
    );
    if (stagedVersionChanges.code !== 0)
      await run("git", ["commit", "-m", `chore: release ${tag}`]);
    committed = true;
    await run("git", [
      "tag",
      "-a",
      tag,
      "-m",
      `StreamDash ${version}`,
    ]);
    releaseStatus(92, "Pushing main and the release tag");
    await run("git", ["push", "--atomic", "origin", "main", tag], {
      stream: true,
    });
    releaseStatus(
      96,
      "Publishing the GitHub release (Store MSIX stays local)",
    );
    await run("gh", [
      "release",
      "create",
      tag,
      installerAsset,
      signatureAsset,
      manifestPath,
      "--repo",
      repo,
      "--title",
      `StreamDash ${version}`,
      "--notes",
      (summary ?? "").trim(),
      "--generate-notes",
      "--verify-tag",
      "--latest",
    ], { stream: true });
    releaseStatus(
      100,
      `StreamDash ${version} is published`,
    );
    p.note(
      join(root, "src-tauri", "target", "release", "bundle", "msix"),
      "Microsoft Store MSIX (local only)",
    );
    p.outro(`https://github.com/${repo}/releases/tag/${tag}`);
  } catch (error) {
    if (!committed)
      await Promise.all(
        [...snapshots].map(([file, content]) => {
          const path = join(root, file);
          return content == null
            ? rm(path, { force: true })
            : writeFile(path, content);
        }),
      );
    throw error;
  }
}

main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  p.outro(
    "Release failed. Nothing was published unless the error explicitly occurred during the push or GitHub release step.",
  );
  process.exitCode = 1;
});
