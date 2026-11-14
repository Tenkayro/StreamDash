import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const androidDir = join(root, "android-companion");
const isWin = process.platform === "win32";
const debugMode = process.argv.includes("--debug");
const releaseMode = !debugMode;
const skipTests = process.argv.includes("--skip-tests");
const installMode = process.argv.includes("--install");
const explicitSerial =
  process.argv.find((arg) => arg.startsWith("--serial="))?.slice("--serial=".length).trim() ||
  process.env.ANDROID_SERIAL?.trim() ||
  "";

function resolveAndroidToolchainEnv() {
  const env = { ...process.env };
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const androidRoot = join(localAppData, "Android");

  if (!env.ANDROID_HOME) {
    const sdkCandidates = [
      join(androidRoot, "Sdk"),
      join(homedir(), "Android", "Sdk"),
    ];
    const foundSdk = sdkCandidates.find((dir) => existsSync(dir));
    if (foundSdk) {
      env.ANDROID_HOME = foundSdk;
      env.ANDROID_SDK_ROOT = foundSdk;
    }
  }

  const portableJdk17 = join(androidRoot, "jdk-17");
  if (existsSync(join(portableJdk17, "bin", isWin ? "java.exe" : "java"))) {
    env.JAVA_HOME = portableJdk17;
  }

  if (releaseMode && !env.ANDROID_KEYSTORE_PATH) {
    const localSigningEnv = join(homedir(), ".android", "streamdash-companion-signing.env");
    if (existsSync(localSigningEnv)) {
      for (const rawLine of readFileSync(localSigningEnv, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx).trim();
          const value = line.slice(eqIdx + 1).trim();
          if (key && !env[key]) env[key] = value;
        }
      }
    }
  }

  return env;
}

const env = resolveAndroidToolchainEnv();
const gradlew = isWin ? join(androidDir, "gradlew.bat") : "./gradlew";
const tasks = [];
if (!skipTests) tasks.push("testDebugUnitTest");
tasks.push(releaseMode ? "assembleRelease" : "assembleDebug");
if (process.env.CI) tasks.push("--no-daemon");

const result = isWin
  ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${gradlew} ${tasks.join(" ")}"`], {
      cwd: androidDir,
      env,
      stdio: "inherit",
      windowsVerbatimArguments: true,
    })
  : spawnSync(gradlew, tasks, {
      cwd: androidDir,
      env,
      stdio: "inherit",
    });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const apkDir = join(androidDir, "app", "build", "outputs", "apk", releaseMode ? "release" : "debug");
const preferredApkName = releaseMode ? "StreamDash-Android.apk" : "StreamDash-Android-debug.apk";
let builtApkPath = "";
if (existsSync(apkDir)) {
  const apks = readdirSync(apkDir).filter((f) => f.endsWith(".apk"));
  for (const apk of apks) {
    const fullPath = join(apkDir, apk);
    const sizeMb = (statSync(fullPath).size / (1024 * 1024)).toFixed(2);
    console.log(`\nAPK built: ${apk} (${sizeMb} MB)`);
    if (apk === preferredApkName || !builtApkPath) {
      builtApkPath = fullPath;
    }
  }
  console.log(`Open folder: ${pathToFileURL(apkDir).href}`);
}

function resolveAdbExecutable(androidEnv) {
  const exeName = isWin ? "adb.exe" : "adb";
  if (androidEnv.ANDROID_HOME) {
    const candidate = join(androidEnv.ANDROID_HOME, "platform-tools", exeName);
    if (existsSync(candidate)) return candidate;
  }
  return exeName;
}

function selectTargetSerial(adbPath) {
  if (explicitSerial) return explicitSerial;
  const listed = spawnSync(adbPath, ["devices"], { encoding: "utf8" });
  if (listed.error || listed.status !== 0) {
    console.error("Failed to run adb devices:", listed.error?.message || listed.stderr || listed.status);
    process.exit(1);
  }
  const rows = (listed.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices attached"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2);

  const ready = rows.filter((parts) => parts[1] === "device").map((parts) => parts[0]);
  if (ready.length === 0) {
    const blocked = rows.map((parts) => `${parts[0]} (${parts[1]})`).join(", ");
    console.error(
      blocked
        ? `No ready Android device found via ADB (detected: ${blocked}). Unlock phone and accept USB debugging prompt.`
        : "No Android device found via ADB. Connect your phone with USB debugging enabled."
    );
    process.exit(1);
  }
  if (ready.length === 1) return ready[0];

  const usbPreferred = ready.find((id) => !id.startsWith("emulator-") && !id.includes("_adb-tls-connect"));
  const chosen = usbPreferred || ready[0];
  console.log(`Multiple ADB devices found (${ready.join(", ")}); installing to ${chosen}. Override with -- --serial=<id>.`);
  return chosen;
}

if (installMode) {
  if (!builtApkPath || !existsSync(builtApkPath)) {
    console.error(`Built APK not found in ${apkDir}`);
    process.exit(1);
  }
  const adbPath = resolveAdbExecutable(env);
  const serial = selectTargetSerial(adbPath);
  console.log(`\nInstalling ${builtApkPath} onto ${serial}...`);
  const installResult = spawnSync(adbPath, ["-s", serial, "install", "-r", builtApkPath], {
    stdio: "inherit",
  });
  if (installResult.error) {
    console.error("Failed to execute adb install:", installResult.error.message);
    process.exit(1);
  }
  if (installResult.status !== 0) {
    process.exit(installResult.status ?? 1);
  }
  console.log("Android Companion installed successfully.");
}

if (releaseMode) {
  console.log("Release APK matches GitHub release signing and auto-updates via GitHub Releases.");
} else {
  console.log("StreamDash Companion Dev checks for this build automatically over Wi-Fi when Host Mode is running.");
}
