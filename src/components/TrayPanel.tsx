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
import twitchIcon from "../assets/services/twitch.webp";
import titlebarLogo from "../assets/branding/streamdash-logo-titlebar.webp";
import { resolveLanguage } from "../i18n";
import { isTauri } from "../lib/utils";
import { useAppStore } from "../stores/app-store";
import type { ConnectionPhase } from "../types";

type TrayStatus = {
  language: string;
  live: boolean;
  viewers?: number;
  twitchAccount?: string;
  twitchPhase: ConnectionPhase;
  streamElementsPhase: ConnectionPhase;
};

const initialStatus: TrayStatus = {
  language: resolveLanguage("auto"),
  live: false,
  twitchPhase: "disconnected",
  streamElementsPhase: "disconnected",
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
      title={`${name} · ${detail}`}
      aria-label={`${name}: ${detail}`}
      className="relative grid size-9 place-items-center rounded-lg"
    >
      <img src={icon} alt="" className="size-5 object-contain" />
      <span className={`absolute bottom-1 right-1 size-2 rounded-full border-2 border-panel ${statusColor(phase)}`} />
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
      className="grid size-10 place-items-center rounded-xl text-zinc-500 transition hover:bg-accent-soft hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

export function TrayBridge() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const twitch = useAppStore((state) => state.twitch);
  const streamElements = useAppStore((state) => state.streamElements);
  const stats = useAppStore((state) => state.stats);

  const publish = useCallback(async () => {
    if (!isTauri()) return;
    const status: TrayStatus = {
      language: resolveLanguage(settings.language),
      live: stats.live,
      viewers: stats.viewers,
      twitchAccount: twitch.account,
      twitchPhase: twitch.phase,
      streamElementsPhase: streamElements.phase,
    };
    await emit("tray-status", status);
    const streamStatus = stats.live ? t("tray.live") : t("tray.offline");
    const twitchStatus = twitch.account || t(`connectionPhases.${twitch.phase}`);
    await invoke("tray_set_tooltip", {
      tooltip: t("tray.tooltip", { streamStatus, twitchStatus }),
    }).catch(() => undefined);
  }, [settings.language, stats.live, stats.viewers, streamElements.phase, t, twitch.account, twitch.phase]);

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
  const reconnecting = [status.twitchPhase, status.streamElementsPhase].some(
    (phase) => phase === "connecting" || phase === "reconnecting",
  );

  useEffect(() => {
    let disposed = false;
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
    <div className="h-screen overflow-hidden bg-[#0b0c0f] p-1.5">
      <main className="h-full overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60">
        <header className="flex h-12 items-center gap-3 border-b border-line px-3">
          <img src={titlebarLogo} alt="StreamDash" className="h-4 w-auto object-contain" />
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${status.live ? "bg-red-400/10 text-red-300" : "bg-white/5 text-zinc-500"}`}
          >
            <span className={`size-1.5 rounded-full ${status.live ? "animate-pulse bg-red-400" : "bg-zinc-600"}`} />
            {status.live ? t("tray.live") : t("tray.offline")}
          </span>
          <button
            type="button"
            title={t("tray.quit")}
            aria-label={t("tray.quit")}
            onClick={() => void invoke("tray_action", { action: "quit" })}
            className="grid size-8 place-items-center rounded-lg text-zinc-600 transition hover:bg-red-400/10 hover:text-red-300"
          >
            <Power size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="p-3">
          <div className="flex h-12 items-center rounded-xl bg-black/10 px-2">
            <div
              title={t("tray.currentViewers")}
              aria-label={`${t("tray.currentViewers")}: ${viewerCount}`}
              className="flex min-w-0 items-center gap-2 px-1 text-zinc-400"
            >
              <Eye size={17} className="text-accent" aria-hidden="true" />
              <span className="text-base font-semibold tabular-nums text-zinc-200">{viewerCount}</span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <ServiceStatus icon={twitchIcon} name="Twitch" phase={status.twitchPhase} account={status.twitchAccount} />
              <ServiceStatus icon={streamElementsIcon} name="StreamElements" phase={status.streamElementsPhase} />
            </div>
          </div>

          <div
            className="mt-2 flex items-center justify-between rounded-xl border border-line bg-black/10 p-1"
            aria-label={t("tray.quickActions")}
          >
            <QuickAction icon={LayoutDashboard} label={t("nav.dashboard")} action="dashboard" />
            <QuickAction icon={RadioTower} label={t("nav.stream")} action="stream" />
            <QuickAction icon={MessageSquare} label={t("nav.chat")} action="chat" />
            <QuickAction icon={Activity} label={t("nav.activity")} action="activity" />
            <button
              type="button"
              disabled={reconnecting}
              title={reconnecting ? t("tray.reconnecting") : t("tray.reconnect")}
              aria-label={reconnecting ? t("tray.reconnecting") : t("tray.reconnect")}
              onClick={() => void invoke("tray_action", { action: "reconnect" })}
              className="grid size-10 place-items-center rounded-xl text-zinc-500 transition hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            >
              <RefreshCw size={18} className={reconnecting ? "animate-spin" : ""} aria-hidden="true" />
            </button>
            <QuickAction icon={Settings} label={t("nav.settings")} action="settings" />
          </div>
        </div>
      </main>
    </div>
  );
}
