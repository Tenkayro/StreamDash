import { useSearchLanding } from "./lib/search-navigation";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useAppStore } from "./stores/app-store";
import { isTauri } from "./lib/utils";
import { LoadingIndicator } from "./components/ui";
import { useTranslation } from "react-i18next";
import { resolveLanguage } from "./i18n";
import { SetupWizard } from "./components/SetupWizard";
import { useRuntime } from "./services/runtime-context";
import { AppContextMenu } from "./components/AppContextMenu";

const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const pageLoaders = {
  dashboard: () =>
    import("./pages/Dashboard").then((module) => ({
      default: module.Dashboard,
    })),
  stream: () =>
    import("./pages/StreamPage").then((module) => ({
      default: module.StreamPage,
    })),
  chat: () =>
    import("./pages/ChatPage").then((module) => ({
      default: module.ChatPage,
    })),
  activity: () =>
    import("./pages/ActivityPage").then((module) => ({
      default: module.ActivityPage,
    })),
  donations: () =>
    import("./pages/Donations").then((module) => ({
      default: module.Donations,
    })),
  donationTool: () =>
    import("./pages/DonationTool").then((module) => ({
      default: module.DonationTool,
    })),
  livePreview: () =>
    import("./pages/LivePreview").then((module) => ({
      default: module.LivePreview,
    })),
  statistics: () =>
    import("./pages/Statistics").then((module) => ({
      default: module.Statistics,
    })),
  goals: () =>
    import("./pages/Goals").then((module) => ({ default: module.Goals })),
  obs: () =>
    import("./pages/ObsPage").then((module) => ({ default: module.ObsPage })),
  connections: () =>
    import("./pages/Connections").then((module) => ({
      default: module.Connections,
    })),
  settings: () =>
    import("./pages/SettingsPage").then((module) => ({
      default: module.SettingsPage,
    })),
};

const Dashboard = lazy(pageLoaders.dashboard);
const StreamPage = lazy(pageLoaders.stream);
const ChatPage = lazy(pageLoaders.chat);
const ActivityPage = lazy(pageLoaders.activity);
const Donations = lazy(pageLoaders.donations);
const DonationTool = lazy(pageLoaders.donationTool);
const LivePreview = lazy(pageLoaders.livePreview);
const Statistics = lazy(pageLoaders.statistics);
const Goals = lazy(pageLoaders.goals);
const ObsPage = lazy(pageLoaders.obs);
const Connections = lazy(pageLoaders.connections);
const SettingsPage = lazy(pageLoaders.settings);

const pages: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  stream: StreamPage,
  chat: ChatPage,
  activity: ActivityPage,
  donations: Donations,
  donationTool: DonationTool,
  livePreview: LivePreview,
  statistics: Statistics,
  goals: Goals,
  obs: ObsPage,
  connections: Connections,
  settings: SettingsPage,
};

function LifecycleScreen({ version, starting = false }: { version?: string; starting?: boolean }) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  return (
    <div data-tauri-drag-region data-accent={settings.accentColor} data-animations={settings.animations ? "on" : "off"} className="boot-splash lifecycle-screen">
      <div className="boot-splash-content">
        <img
          src="/streamdash-logo-boot.webp"
          alt={starting ? t("common.starting") : ""}
          aria-hidden={starting ? undefined : true}
          className="h-auto object-contain"
        />
        <div className="boot-loader" aria-hidden="true" />
        <div className="boot-meta">
          <span>{t("titleBar.author")}</span>
          <span aria-hidden="true">·</span>
          <span>{t("common.installedVersion", { version: version ?? "…" })}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  useSearchLanding();
  const { page, ready, settings } = useAppStore();
  const { i18n, t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
  const shutdownStarted = useRef(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [appVersion, setAppVersion] = useState<string>();
  const { shutdown } = useRuntime();
  const Page = pages[page] ?? Dashboard;
  const loading = (
    <div
      aria-label={t("common.loadingPage")}
      role="status"
      className="grid h-[55vh] place-items-center"
    >
      <LoadingIndicator className="h-8 w-16" />
    </div>
  );
  useEffect(() => {
    if (isTauri()) void getVersion().then(setAppVersion).catch(() => undefined);
  }, []);
  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);
  useEffect(() => {
    if (!ready) return;
    const preload = () => {
      for (const load of Object.values(pageLoaders)) void load();
    };
    const timer = window.setTimeout(preload, 200);
    return () => window.clearTimeout(timer);
  }, [ready]);
  useEffect(() => {
    const language = resolveLanguage(settings.language);
    if (i18n.resolvedLanguage !== language) void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [i18n, settings.language]);
  useEffect(() => {
    const handleMouseButton = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) useAppStore.getState().goBack();
      else useAppStore.getState().goForward();
    };
    const blockNavigation = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    window.addEventListener("mousedown", blockNavigation, true);
    window.addEventListener("mouseup", handleMouseButton, true);
    window.addEventListener("auxclick", blockNavigation, true);
    return () => {
      window.removeEventListener("mousedown", blockNavigation, true);
      window.removeEventListener("mouseup", handleMouseButton, true);
      window.removeEventListener("auxclick", blockNavigation, true);
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("app-shutdown-requested", async () => {
      if (disposed || shutdownStarted.current) return;
      shutdownStarted.current = true;
      const startedAt = performance.now();
      setShuttingDown(true);
      const logo = new Image();
      logo.src = "/streamdash-logo-boot.webp";
      await logo.decode().catch(() => undefined);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await invoke("app_shutdown_ready").catch(() => undefined);
      try {
        await shutdown();
      } finally {
        const remaining = 700 - (performance.now() - startedAt);
        if (remaining > 0)
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        await invoke("app_quit_complete").catch(() => undefined);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [shutdown]);
  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (useAppStore.getState().settings.minimizeToTray) {
          await appWindow.hide();
        } else {
          await invoke("app_quit");
        }
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);
  const widths = {
    compact: "max-w-[1180px]",
    wide: "max-w-[1500px]",
    full: "max-w-none",
  };
  if (shuttingDown) return <LifecycleScreen version={appVersion} />;
  if (!ready) return <LifecycleScreen version={appVersion} starting />;
  if (!settings.onboardingCompleted)
    return (
      <div
        data-accent={settings.accentColor}
        data-density={settings.uiDensity}
        data-animations={settings.animations ? "on" : "off"}
        className="app-shell flex h-screen flex-col"
      >
        <TitleBar setup />
        <AppContextMenu />
        <SetupWizard />
      </div>
    );
  return (
    <div
      data-accent={settings.accentColor}
      data-density={settings.uiDensity}
      data-animations={settings.animations ? "on" : "off"}
      className={
        settings.animations
          ? ""
          : "**:transition-none! [&_.event-enter]:animate-none!"
      }
    >
      <div className="app-shell flex h-screen flex-col">
        <TitleBar />
        <AppContextMenu />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <div className="app-workspace flex min-h-0 flex-1">
          <Sidebar />
          <div className="relative flex min-w-0 flex-1">
            <main ref={mainRef} className="app-main min-w-0 flex-1 overflow-y-auto">
              <div
                className={`app-content mx-auto ${widths[settings.contentWidth]} ${settings.uiDensity === "compact" ? "p-3 lg:p-4" : "p-3 sm:p-4 xl:p-6"}`}
              >
                <Suspense fallback={loading}>
                  <Page />
                </Suspense>
              </div>
            </main>
            <div
              aria-hidden="true"
              className="app-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 h-10"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
