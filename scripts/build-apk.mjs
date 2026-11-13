import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const androidDir = join(root, "android-companion");
const isWin = process.platform === "win32";
const debugMode = process.argv.includes("--debug");
const releaseMode = !debugMode;
const skipTests = process.argv.includes("--skip-tests");

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
tasks.push("--no-daemon");

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
if (existsSync(apkDir)) {
  const apks = readdirSync(apkDir).filter((f) => f.endsWith(".apk"));
  for (const apk of apks) {
    const fullPath = join(apkDir, apk);
    const sizeMb = (statSync(fullPath).size / (1024 * 1024)).toFixed(2);
    console.log(`\nAPK built: ${fullPath} (${sizeMb} MB)`);
  }
}

if (releaseMode) {
  console.log("Release APK matches GitHub release signing and auto-updates via GitHub Releases.");
} else {
  console.log("StreamDash Companion Dev checks for this build automatically over Wi-Fi when Host Mode is running.");
}
