import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useAppStore } from "./stores/app-store";
import { isTauri } from "./lib/utils";
import { LoadingIndicator } from "./components/ui";
import { useTranslation } from "react-i18next";
import { resolveLanguage } from "./i18n";
import { SetupWizard } from "./components/SetupWizard";

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
const LivePreview = lazy(pageLoaders.livePreview);
const Statistics = lazy(pageLoaders.statistics);
const Goals = lazy(pageLoaders.goals);
const Connections = lazy(pageLoaders.connections);
const SettingsPage = lazy(pageLoaders.settings);

const pages: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  stream: StreamPage,
  chat: ChatPage,
  activity: ActivityPage,
  livePreview: LivePreview,
  statistics: Statistics,
  goals: Goals,
  connections: Connections,
  settings: SettingsPage,
};
export default function App() {
  const { page, ready, settings } = useAppStore();
  const { i18n, t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
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
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    appWindow
      .onCloseRequested(async (event) => {
        if (useAppStore.getState().settings.minimizeToTray) {
          event.preventDefault();
          await appWindow.hide();
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
  if (!ready)
    return (
      <div
        data-tauri-drag-region
        className="grid h-screen place-items-center bg-[#0b0c0f]"
      >
        <img
          src="/streamdash-logo-boot.webp"
          alt={t("common.starting")}
          className="h-auto w-80 max-w-[70vw] object-contain animate-pulse"
        />
      </div>
    );
  if (!settings.onboardingCompleted)
    return (
      <div
        data-accent={settings.accentColor}
        data-density={settings.uiDensity}
        data-animations={settings.animations ? "on" : "off"}
        className="flex h-screen flex-col bg-[#0b0c0f]"
      >
        <TitleBar setup />
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
      <div className="flex h-screen flex-col bg-[#0b0c0f]">
        <TitleBar />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
            <div
              className={`mx-auto ${widths[settings.contentWidth]} ${settings.uiDensity === "compact" ? "p-4" : "p-6"}`}
            >
              <Suspense fallback={loading}>
                <Page />
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
