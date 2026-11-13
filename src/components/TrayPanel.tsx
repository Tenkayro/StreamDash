import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  Eye,
  LayoutDashboard,
  MessageSquare,
  Power,
  RadioTower,
  RefreshCw,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import obsIcon from "../assets/services/obs.svg";
import twitchIcon from "../assets/services/twitch.webp";
import titlebarLogo from "../assets/branding/streamdash-logo-titlebar.webp";
import { resolveLanguage } from "../i18n";
import { isTauri } from "../lib/utils";
import { defaultSettings, useAppStore } from "../stores/app-store";
import type { AppSettings, ConnectionPhase } from "../types";

type TrayStatus = {
  accentColor: AppSettings["accentColor"];
  animations: boolean;
  language: string;
  live: boolean;
  viewers?: number;
  twitchAccount?: string;
  twitchPhase: ConnectionPhase;
  streamElementsPhase: ConnectionPhase;
  tipeeStreamPhase: ConnectionPhase;
  obsPhase: ConnectionPhase;
};

const initialStatus: TrayStatus = {
  accentColor: defaultSettings.accentColor,
  animations: defaultSettings.animations,
  language: resolveLanguage("auto"),
  live: false,
  twitchPhase: "disconnected",
  streamElementsPhase: "disconnected",
  tipeeStreamPhase: "disconnected",
  obsPhase: "disconnected",
};

function statusColor(phase: ConnectionPhase) {
  if (phase === "connected") return "bg-emerald-400";
  if (phase === "connecting" || phase === "reconnecting") return "bg-amber-400";
  if (phase === "error" || phase === "expired") return "bg-red-400";
  return "bg-zinc-600";
}

function ServiceStatus({ icon, name, phase, account }: { icon: string; name: string; phase: ConnectionPhase; account?: string }) {
  const { t } = useTranslation();
  const detail = account || t(`connectionPhases.${phase}`);

  return (
    <div
      role="img"
      title={`${name} · ${detail}`}
      aria-label={`${name}: ${detail}`}
      className="flex h-9 items-center px-1"
    >
      <span className="relative shrink-0">
        <img src={icon} alt="" className="size-4 object-contain" />
        <span className={`absolute -bottom-1 -right-1 size-2 rounded-full border-2 border-panel ${statusColor(phase)}`} />
      </span>
    </div>
  );
}

function QuickAction({ icon: Icon, label, action }: { icon: LucideIcon; label: string; action: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => void invoke("tray_action", { action })}
      className="tray-action flex h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-rule bg-raised px-1.5 text-muted transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon size={15} className="shrink-0" aria-hidden="true" />
      <span className="max-w-full whitespace-nowrap text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

export function TrayBridge() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const twitch = useAppStore((state) => state.twitch);
  const streamElements = useAppStore((state) => state.streamElements);
  const tipeeStream = useAppStore((state) => state.tipeeStream);
  const obs = useAppStore((state) => state.obs);
  const stats = useAppStore((state) => state.stats);

  const publish = useCallback(async () => {
    if (!isTauri()) return;
    const status: TrayStatus = {
      accentColor: settings.accentColor,
      animations: settings.animations,
      language: resolveLanguage(settings.language),
      live: stats.live,
      viewers: stats.viewers,
      twitchAccount: twitch.account,
      twitchPhase: twitch.phase,
      streamElementsPhase: streamElements.phase,
      tipeeStreamPhase: tipeeStream.phase,
      obsPhase: obs.phase,
    };
    await emit("tray-status", status);
    const streamStatus = stats.live ? t("tray.live") : t("tray.offline");
    const twitchStatus = twitch.account || t(`connectionPhases.${twitch.phase}`);
    await invoke("tray_configure", {
      config: {
        mode: settings.trayStyle,
        status: t("tray.statusSummary", { streamStatus, twitchStatus }),
        open: t("tray.open"),
        dashboard: t("nav.dashboard"),
        stream: t("nav.stream"),
        chat: t("nav.chat"),
        activity: t("nav.activitys"),
        reconnect: t("tray.reconnect"),
        settings: t("nav.settings"),
        quit: t("tray.quit"),
      },
    }).catch(() => undefined);
    await invoke("tray_set_tooltip", {
      tooltip: t("tray.tooltip", { streamStatus, twitchStatus }),
    }).catch(() => undefined);
  }, [obs.phase, settings.accentColor, settings.animations, settings.language, settings.trayStyle, stats.live, stats.viewers, streamElements.phase, t, tipeeStream.phase, twitch.account, twitch.phase]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("tray-request-status", () => void publish()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    void publish();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [publish]);

  return null;
}

export function TrayPanel() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<TrayStatus>(initialStatus);
  const reconnecting = [status.twitchPhase, status.streamElementsPhase, status.tipeeStreamPhase, status.obsPhase].some(
    (phase) => phase === "connecting" || phase === "reconnecting",
  );

  useEffect(() => {
    let disposed = false;
    if (!isTauri()) return;
    const stops: Array<() => void> = [];
    void Promise.all([
      listen<TrayStatus>("tray-status", ({ payload }) => {
        setStatus(payload);
        void i18n.changeLanguage(payload.language);
        document.documentElement.lang = payload.language;
      }),
      listen("tray-opened", () => void emit("tray-request-status")),
    ]).then((listeners) => {
      if (disposed) listeners.forEach((stop) => stop());
      else stops.push(...listeners);
    });
    void emit("tray-request-status");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void getCurrentWindow().hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [i18n]);

  const viewerCount = status.live ? (status.viewers?.toLocaleString(i18n.language) ?? "—") : "—";

  return (
    <main data-accent={status.accentColor} data-animations={status.animations ? "on" : "off"} className="tray-panel flex h-dvh flex-col overflow-hidden rounded-xl">
        <header className="tray-header flex h-11 shrink-0 items-center gap-3 border-b border-rule px-3.5">
          <img src={titlebarLogo} alt="StreamDash" className="h-4 w-auto object-contain" />
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${status.live ? "border-red-500/35 bg-red-500/12 text-red-200" : "border-rule bg-well text-muted"}`}
          >
            <span className={`size-1.5 rounded-full ${status.live ? "animate-pulse bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]" : "bg-subtle"}`} />
            {status.live ? t("tray.live") : t("tray.offline")}
          </span>
          <button
            type="button"
            title={t("tray.quit")}
            aria-label={t("tray.quit")}
            onClick={() => void invoke("tray_action", { action: "quit" })}
            className="grid size-7 place-items-center rounded-md border border-rule bg-raised text-muted transition-colors hover:border-red-400/35 hover:bg-red-500/12 hover:text-red-300"
          >
            <Power size={13} aria-hidden="true" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-between p-2.5">
          <div className="tray-status flex h-11 shrink-0 items-center rounded-lg px-2.5">
            <div
              title={t("tray.currentViewers")}
              aria-label={`${t("tray.currentViewers")}: ${viewerCount}`}
              className="flex min-w-0 items-center gap-2 px-1 text-muted"
            >
              <Eye size={15} className="text-accent" aria-hidden="true" />
              <span className="text-xs text-muted">{t("stream.viewers")}</span>
              <span className="studio-mono text-sm font-semibold text-ink-strong">{viewerCount}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ServiceStatus icon={twitchIcon} name="Twitch" phase={status.twitchPhase} account={status.twitchAccount} />
              <ServiceStatus icon={streamElementsIcon} name="StreamElements" phase={status.streamElementsPhase} />
              <ServiceStatus icon={tipeeStreamIcon} name="TipeeeStream" phase={status.tipeeStreamPhase} />
              <ServiceStatus icon={obsIcon} name="OBS" phase={status.obsPhase} />
            </div>
          </div>

          <div
            className="tray-actions mt-2 grid grid-cols-3 gap-1.5 rounded-xl p-1.5"
            aria-label={t("tray.quickActions")}
          >
            <QuickAction icon={LayoutDashboard} label={t("nav.dashboard")} action="dashboard" />
            <QuickAction icon={RadioTower} label={t("nav.stream")} action="stream" />
            <QuickAction icon={MessageSquare} label={t("nav.chat")} action="chat" />
            <QuickAction icon={Activity} label={t("nav.activitys")} action="activitys" />
            <button
              type="button"
              disabled={reconnecting}
              title={reconnecting ? t("tray.reconnecting") : t("tray.reconnect")}
              aria-label={reconnecting ? t("tray.reconnecting") : t("tray.reconnect")}
              onClick={() => void invoke("tray_action", { action: "reconnect" })}
              className="tray-action flex h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-rule bg-raised px-1.5 text-muted transition-colors hover:border-accent-border hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            >
              <RefreshCw size={15} className={`shrink-0 ${reconnecting ? "animate-spin" : ""}`} aria-hidden="true" />
              <span className="max-w-full whitespace-nowrap text-[10px] font-medium leading-none">{t("tray.retry")}</span>
            </button>
            <QuickAction icon={Settings} label={t("nav.settings")} action="settings" />
          </div>
        </div>
    </main>
  );
}
