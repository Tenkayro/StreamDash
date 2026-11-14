import { useSearchLanding } from "./lib/search-navigation";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { useRuntime } from "./services/runtime-context";
import { DEV_RENDER_CRASH_EVENT } from "./lib/dev-bridge";

const SetupWizard = lazy(() =>
  import("./components/SetupWizard").then((module) => ({
    default: module.SetupWizard,
  })),
);

function DevCrashTrigger() {
  const [shouldCrash, setShouldCrash] = useState(false);

  useEffect(() => {
    const onCrash = () => setShouldCrash(true);
    window.addEventListener(DEV_RENDER_CRASH_EVENT, onCrash);
    return () => window.removeEventListener(DEV_RENDER_CRASH_EVENT, onCrash);
  }, []);

  if (shouldCrash) {
    throw new Error("DevTools: Simulated React render crash");
  }
  return null;
}
import { AppContextMenu } from "./components/AppContextMenu";
import { CrashBoundary } from "./components/CrashHandler";
import { CurvedScrollbar } from "./components/CurvedScrollbar";

const DemoOverlay = import.meta.env.DEV
  ? lazy(() => import("./components/DemoOverlay"))
  : null;

function DevDemoAutoStart() {
  const ready = useAppStore((s) => s.ready);

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      import.meta.env.VITE_DEMO_AUTO !== "1" ||
      !ready
    ) {
      return;
    }
    void import("./lib/demo-runner").then((m) => m.startAutoDemoOnce());
  }, [ready]);

  return null;
}

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
  activitys: () =>
    import("./pages/ActivityPage").then((module) => ({
      default: module.ActivityPage,
    })),
  commands: () =>
    import("./pages/CommandsPage").then((module) => ({
      default: module.CommandsPage,
    })),
  chatAlerts: () =>
    import("./pages/ChatAlertsPage").then((module) => ({
      default: module.ChatAlertsPage,
    })),
  variables: () =>
    import("./pages/VariablesPage").then((module) => ({
      default: module.VariablesPage,
    })),
  channelPoints: () =>
    import("./pages/ChannelPointsPage").then((module) => ({
      default: module.ChannelPointsPage,
    })),
  giveaways: () =>
    import("./pages/GiveawaysPage").then((module) => ({
      default: module.GiveawaysPage,
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
  host: () =>
    import("./pages/HostPage").then((module) => ({
      default: module.HostPage,
    })),
  settings: () =>
    import("./pages/SettingsPage").then((module) => ({
      default: module.SettingsPage,
    })),
};

const Dashboard = lazy(pageLoaders.dashboard);
const StreamPage = lazy(pageLoaders.stream);
const ChatPage = lazy(pageLoaders.chat);
const ActivityPage = lazy(pageLoaders.activitys);
const CommandsPage = lazy(pageLoaders.commands);
const ChatAlertsPage = lazy(pageLoaders.chatAlerts);
const VariablesPage = lazy(pageLoaders.variables);
const ChannelPointsPage = lazy(pageLoaders.channelPoints);
const GiveawaysPage = lazy(pageLoaders.giveaways);
const LivePreview = lazy(pageLoaders.livePreview);
const Statistics = lazy(pageLoaders.statistics);
const Goals = lazy(pageLoaders.goals);
const ObsPage = lazy(pageLoaders.obs);
const Connections = lazy(pageLoaders.connections);
const HostPage = lazy(pageLoaders.host);
const SettingsPage = lazy(pageLoaders.settings);

const pages: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  stream: StreamPage,
  chat: ChatPage,
  activitys: ActivityPage,
  activity: ActivityPage,
  donations: ActivityPage,
  commands: CommandsPage,
  chatAlerts: ChatAlertsPage,
  variables: VariablesPage,
  channelPoints: ChannelPointsPage,
  giveaways: GiveawaysPage,
  livePreview: LivePreview,
  statistics: Statistics,
  goals: Goals,
  obs: ObsPage,
  connections: Connections,
  host: HostPage,
  settings: SettingsPage,
};

function getBootLogoSrc() {
  return (
    document.getElementById("boot-splash-logo")?.getAttribute("src") ||
    "/streamdash-logo-boot.webp"
  );
}

function LifecycleScreen({ version, starting = false }: { version?: string; starting?: boolean }) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const logoSrc = getBootLogoSrc();
  return (
    <div data-tauri-drag-region data-accent={settings.accentColor} data-animations={settings.animations ? "on" : "off"} className="boot-splash lifecycle-screen">
      <div className="boot-splash-content">
        <div className="boot-logo-stage">
          <img
            src={logoSrc}
            decoding="sync"
            alt={starting ? t("common.starting") : t("common.shuttingDown")}
            className="boot-logo-base"
          />
          <img
            src={logoSrc}
            decoding="sync"
            alt=""
            aria-hidden="true"
            className="boot-logo-fill"
          />
        </div>
        <div className="boot-status">
          {starting ? t("common.starting") : t("common.shuttingDown")}
        </div>
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
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);
  useEffect(() => {
    // Only preload all 16 route chunks on desktop; on mobile HTTP/1.1 this starves the active view.
    if (!ready || !isTauri()) return;
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
      logo.src = getBootLogoSrc();
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
  const isViewportPage = [
    "chat",
    "commands",
    "chatAlerts",
    "variables",
    "channelPoints",
    "giveaways",
    "livePreview",
    "activitys",
    "activity",
    "donations",
  ].includes(page);
  const isFullWidthPage = page === "chat" || page === "giveaways";
  if (shuttingDown) return <LifecycleScreen version={appVersion} />;
  if (!ready) return <LifecycleScreen version={appVersion} starting />;
  if (!settings.onboardingCompleted)
    return (
      <div
        data-accent={settings.accentColor}
        data-density={settings.uiDensity}
        data-animations={settings.animations ? "on" : "off"}
        className="app-shell flex h-dvh flex-col"
      >
        <TitleBar setup />
        <AppContextMenu />
        {import.meta.env.DEV && DemoOverlay && (
          <Suspense fallback={null}>
            <DevDemoAutoStart />
            <DemoOverlay />
          </Suspense>
        )}
        <Suspense fallback={loading}>
          <SetupWizard />
        </Suspense>
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
      <div className="app-shell flex h-dvh flex-col">
        <TitleBar />
        <AppContextMenu />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        {import.meta.env.DEV && DemoOverlay && (
          <Suspense fallback={null}>
            <DevDemoAutoStart />
            <DemoOverlay />
          </Suspense>
        )}
        <div className="app-workspace flex min-h-0 flex-1">
          <Sidebar />
          <div className="relative flex min-w-0 flex-1">
            <main
              ref={mainRef}
              className={`app-main min-w-0 flex-1 ${isViewportPage ? "overflow-y-auto md:overflow-hidden" : "overflow-y-auto"}`}
            >
              <div
                style={
                  page === "dashboard" || !isTauri()
                    ? undefined
                    : { zoom: Math.max(50, Math.min(150, settings.dashboardZoom || 100)) / 100 }
                }
                className={`app-content mx-auto w-full ${isFullWidthPage ? "max-w-none" : widths[settings.contentWidth]} ${isViewportPage ? "flex min-h-full flex-col md:h-full md:min-h-0" : ""} ${settings.uiDensity === "compact" ? "p-3 lg:p-4" : "p-3 sm:p-4 xl:p-5"}`}
              >
                <CrashBoundary key={page}>
                  {import.meta.env.DEV && <DevCrashTrigger />}
                  <Suspense fallback={loading}>
                    <Page />
                  </Suspense>
                </CrashBoundary>
              </div>
            </main>
            {!isViewportPage && isTauri() && (
              <>
                <CurvedScrollbar scrollerRef={mainRef} />
                <div
                  aria-hidden="true"
                  className="app-bottom-fade pointer-events-none absolute inset-x-0 bottom-0 h-10"
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
