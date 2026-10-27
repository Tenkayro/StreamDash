import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const repo = "Tenkayro/StreamDash";
const betaManifestFile = "beta.json";
const betaConfigTemplate = "src-tauri/tauri.beta.conf.json";
const betaGeneratedConfig = "src-tauri/tauri.beta.generated.conf.json";
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
      if (code === 0 || options.allowFailure)
        return resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() });
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

async function nextBetaVersion(baseVersion) {
  await run("git", ["fetch", "origin", "--tags"]);
  const tags = await run("git", ["tag", "--list", `v${baseVersion}-beta.*`]);
  const numbers = tags.stdout
    .split(/\r?\n/)
    .map((tag) => new RegExp(`^v${baseVersion.replaceAll(".", "\\.")}-beta\\.(\\d+)$`).exec(tag)?.[1])
    .filter(Boolean)
    .map(Number);
  return `${baseVersion}-beta.${Math.max(0, ...numbers) + 1}`;
}

async function writeBetaBuildConfig(version) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(version);
  if (!parsed) throw new Error(`Invalid beta version: ${version}`);
  const [, major, minor, patch, beta] = parsed;
  const config = JSON.parse(
    await readFile(join(root, betaConfigTemplate), "utf8"),
  );
  config.version = version;
  config.bundle.windows.wix.version = `${major}.${minor}.${patch}.${beta}`;
  const path = join(root, betaGeneratedConfig);
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
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
    const status = await run("git", ["status", "--porcelain"]);
    pendingChanges = status.stdout;
    await run("gh", ["auth", "status"]);
    const remote = await run("git", ["remote", "get-url", "origin"]);
    if (!remote.stdout.toLowerCase().includes("tenkayro/streamdash"))
      throw new Error(`origin does not point to ${repo}.`);
    const branch = await run("git", ["branch", "--show-current"]);
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

  const releaseChannel = await p.select({
    message: "Choose the release channel:",
    options: [
      {
        value: "stable",
        label: "Stable release",
        hint: "GitHub latest + local Microsoft Store MSIX",
      },
      {
        value: "beta",
        label: "Beta prerelease",
        hint: "Separate app, GitHub only, no Store build",
      },
    ],
  });
  cancelled(releaseChannel);
  const isBeta = releaseChannel === "beta";

  const currentVersion = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const headPackage = await run("git", ["show", "HEAD:package.json"]);
  const headVersion = JSON.parse(headPackage.stdout).version;
  const hasUnreleasedWorkingVersion = currentVersion !== headVersion;
  let bump = "beta";
  let version;
  if (isBeta) {
    if (!parseVersion(currentVersion))
      throw new Error("Beta releases require a stable base version such as 1.9.0.");
    version = await nextBetaVersion(currentVersion);
  } else {
    bump = await p.select({
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
    version =
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
  }

  const summary = await p.text({
    message: "Short release summary for latest.json",
    defaultValue: `StreamDash${isBeta ? " Beta" : ""} ${version} improvements and fixes.`,
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
  const existingTag = await run(
    "git",
    ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
    { allowFailure: true },
  );
  if (existingTag.code === 0) throw new Error(`Tag ${tag} already exists.`);
  const existingRelease = await run(
    "gh",
    ["release", "view", tag, "--repo", repo],
    { allowFailure: true },
  );
  if (existingRelease.code === 0)
    throw new Error(`GitHub release ${tag} already exists.`);

  p.note(
    [
      `${currentVersion}  ->  ${version}`,
      `Channel: ${isBeta ? "Beta prerelease" : "Stable"}`,
      `Repository: ${repo}`,
      `GitHub: ${isBeta ? "separate Beta MSI, signature, beta.json" : "MSI installer, updater signature, latest.json"}`,
      isBeta
        ? "Microsoft Store: skipped for Beta"
        : "Local only: Microsoft Store MSIX (never uploaded to GitHub)",
      "GitHub release notes: generated automatically",
    ].join("\n"),
    "Release summary",
  );
  const confirmed = await p.confirm({
    message: `Build, commit${pendingChanges ? " pending changes" : ""}, tag, push, and publish ${tag}${isBeta ? " as a prerelease" : ""}?`,
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

  const releaseFiles = isBeta ? [betaManifestFile] : versionFiles;
  const snapshots = new Map(await Promise.all(
    releaseFiles.map(async (file) => [
      file,
      await readFile(join(root, file), "utf8").catch(() => null),
    ]),
  ));

  let committed = false;
  let betaConfigPath;
  try {
    const progress = p.spinner();
    progress.start(
      isBeta
        ? `Preparing isolated Beta ${version}`
        : `Updating project versions to ${version}`,
    );
    if (isBeta) betaConfigPath = await writeBetaBuildConfig(version);
    else await updateVersions(version);
    progress.message("Running TypeScript and Rust checks");
    await run("npm", ["run", "check"]);
    await run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);

    const installerAssetName = isBeta
      ? "StreamDash-Beta-Setup.msi"
      : "StreamDash-Setup.msi";
    progress.message(`Building the signed ${isBeta ? "Beta " : ""}MSI updater package`);
    const setupArguments = ["run", "setup"];
    if (isBeta)
      setupArguments.push(
        "--",
        "-ConfigPath", betaConfigPath,
        "-OutputName", installerAssetName,
      );
    await run("npm", setupArguments, {
      env: {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: keyPath,
        STREAMDASH_CHANNEL: isBeta ? "beta" : "stable",
        VITE_STREAMDASH_CHANNEL: isBeta ? "beta" : "stable",
      },
    });

    if (!isBeta) {
      progress.message("Packaging the Microsoft Store MSIX without rebuilding");
      await run("powershell", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "scripts/build-msix.ps1",
        "-SkipBuild",
      ]);
    }

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
    const manifestPath = isBeta
      ? join(root, betaManifestFile)
      : join(bundleDirectory, "latest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    progress.stop(
      isBeta
        ? "Beta GitHub artifacts and update manifest are ready"
        : "GitHub artifacts and local Store MSIX are ready",
    );

    const publish = p.spinner();
    publish.start(`Committing the ${isBeta ? "Beta manifest" : "release version"}`);
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
      `StreamDash${isBeta ? " Beta" : ""} ${version}`,
    ]);
    publish.message("Pushing main and the release tag");
    await run("git", ["push", "--atomic", "origin", "main", tag]);
    publish.message(
      isBeta
        ? "Publishing the GitHub prerelease"
        : "Publishing the GitHub release (Store MSIX stays local)",
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
      `StreamDash${isBeta ? " Beta" : ""} ${version}`,
      "--notes",
      (summary ?? "").trim(),
      "--generate-notes",
      "--verify-tag",
      isBeta ? "--prerelease" : "--latest",
    ]);
    publish.stop(`StreamDash${isBeta ? " Beta" : ""} ${version} is published`);
    if (!isBeta)
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
  } finally {
    if (betaConfigPath) await rm(betaConfigPath, { force: true });
  }
}

main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error));
  p.outro(
    "Release failed. Nothing was published unless the error explicitly occurred during the push or GitHub release step.",
  );
  process.exitCode = 1;
});
