import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import "./index.css";
import "./i18n";
import App from "./App";
import { RuntimeProvider } from "./services/runtime";
import { Toaster } from "sonner";
import { UpdateProvider } from "./services/updater";
import { TrayBridge, TrayPanel } from "./components/TrayPanel";
import { isTauri } from "./lib/utils";

const trayWindow = new URLSearchParams(window.location.search).has("tray");
const splash = document.getElementById("boot-splash");
const splashLogo = splash?.querySelector("img");
const splashVersion = document.getElementById("boot-version");
const bootStartedAt = performance.now();
const MINIMUM_SPLASH_MS = 600;

if (trayWindow) {
  document.documentElement.classList.add("tray-window");
  splash?.remove();
}

function dismissSplash() {
  if (!splash || splash.dataset.hidden === "true") return;
  splash.dataset.hidden = "true";
  window.setTimeout(() => splash.remove(), 240);
}

async function revealWindow() {
  // The window is created hidden, so the splash has to be decoded and painted
  // before it is shown. That way the very first visible frame already shows
  // the logo instead of an empty dark surface.
  await Promise.all([
    splashLogo && !splashLogo.complete
      ? splashLogo.decode().catch(() => undefined)
      : Promise.resolve(),
    isTauri()
      ? getVersion().then((version) => { if (splashVersion) splashVersion.textContent = `v${version}`; }).catch(() => undefined)
      : Promise.resolve(),
  ]);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    requestAnimationFrame(done);
    window.setTimeout(done, 120);
  });
  if (isTauri()) await invoke("reveal_window").catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {trayWindow ? (
      <TrayPanel />
    ) : (
      <UpdateProvider>
        <RuntimeProvider>
          <TrayBridge />
          <App />
          <Toaster theme="dark" position="bottom-right" richColors />
        </RuntimeProvider>
      </UpdateProvider>
    )}
  </StrictMode>,
);

if (!trayWindow) {
  void (async () => {
    await revealWindow();
    const remaining = MINIMUM_SPLASH_MS - (performance.now() - bootStartedAt);
    if (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
    dismissSplash();
  })();
}
