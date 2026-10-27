import { lazy, Suspense, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { Dashboard } from "./pages/Dashboard";
import { useAppStore } from "./stores/app-store";
import { isTauri } from "./lib/utils";
import { LoadingIndicator } from "./components/ui";
import { useTranslation } from "react-i18next";
import { resolveLanguage } from "./i18n";

const StreamPage = lazy(() =>
  import("./pages/StreamPage").then((module) => ({
    default: module.StreamPage,
  })),
);
const ChatPage = lazy(() =>
  import("./pages/ChatPage").then((module) => ({ default: module.ChatPage })),
);
const ActivityPage = lazy(() =>
  import("./pages/ActivityPage").then((module) => ({
    default: module.ActivityPage,
  })),
);
const LivePreview = lazy(() =>
  import("./pages/LivePreview").then((module) => ({
    default: module.LivePreview,
  })),
);
const Statistics = lazy(() =>
  import("./pages/Statistics").then((module) => ({
    default: module.Statistics,
  })),
);
const Goals = lazy(() =>
  import("./pages/Goals").then((module) => ({ default: module.Goals })),
);
const Connections = lazy(() =>
  import("./pages/Connections").then((module) => ({
    default: module.Connections,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);
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
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="min-w-0 flex-1 overflow-y-auto">
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
