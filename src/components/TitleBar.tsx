import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bug,
  Download,
  GitFork,
  LoaderCircle,
  Minus,
  PanelBottomClose,
  Power,
  RotateCcw,
  Square,
  Store,
  Tag,
  UserRound,
  ZoomIn,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { isTauri } from "../lib/utils";
import { useUpdater } from "../services/updater-context";
import titlebarLogo from "../assets/branding/streamdash-logo-titlebar.webp";
import { LoadingIndicator } from "./ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { useTranslation } from "react-i18next";

function TitleAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-md text-zinc-500 transition hover:bg-white/5.5 hover:text-zinc-200"
    >
      <Icon size={13} />
    </button>
  );
}

function UpdateControl() {
  const { t } = useTranslation();
  const updater = useUpdater();
  const downloading =
    updater.phase === "downloading" || updater.phase === "installing";
  const progress =
    updater.phase === "installing" ? 100 : (updater.progress ?? 0);

  if (updater.channel === "store" && updater.phase === "checking")
    return (
      <div
        role="status"
        title={t("titleBar.checkingStore")}
        aria-label={t("titleBar.checkingStore")}
        className="grid size-7 place-items-center text-zinc-500"
      >
        <LoaderCircle size={13} className="animate-spin" />
      </div>
    );

  if (updater.channel === "store" && updater.phase === "available")
    return (
      <button
        type="button"
        title={t("titleBar.updateStore")}
        aria-label={t("titleBar.updateStore")}
        onClick={() => void updater.installUpdate()}
        className="grid size-7 place-items-center rounded-md border border-accent/40 bg-accent-soft text-accent transition hover:border-accent/70 hover:brightness-125"
      >
        <Store size={13} />
      </button>
    );

  if (downloading)
    return (
      <div
        role="status"
        title={
          updater.phase === "installing"
            ? t("titleBar.installing")
            : t("titleBar.downloading", { progress })
        }
        aria-label={
          updater.phase === "installing"
            ? t("titleBar.installing")
            : t("titleBar.downloading", { progress })
        }
        className="relative grid size-7 place-items-center"
      >
        <svg
          viewBox="0 0 28 28"
          className="absolute inset-0 size-7 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="14"
            cy="14"
            r="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-zinc-700"
          />
          <circle
            cx="14"
            cy="14"
            r="12"
            pathLength="100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - progress}
            className="text-accent transition-[stroke-dashoffset] duration-300 ease-out"
          />
        </svg>
        <span className="text-[8px] font-semibold tabular-nums text-zinc-200">
          {progress}%
        </span>
      </div>
    );

  if (updater.phase === "available")
    return (
      <button
        type="button"
        title={t("titleBar.downloadVersion", { version: updater.version })}
        aria-label={t("titleBar.downloadVersion", { version: updater.version })}
        onClick={() => void updater.installUpdate()}
        className="grid size-7 place-items-center rounded-md border border-accent/40 bg-accent-soft text-accent transition hover:border-accent/70 hover:brightness-125"
      >
        <Download size={13} />
      </button>
    );

  if (updater.phase === "error")
    return (
      <button
        type="button"
        title={t("titleBar.checkAgain")}
        aria-label={t("titleBar.checkAgain")}
        onClick={() => void updater.checkForUpdates()}
        className="grid size-7 place-items-center rounded-md text-red-300 transition hover:bg-red-400/10"
      >
        <RotateCcw size={13} />
      </button>
    );

  return null;
}

export function TitleBar({ setup = false }: { setup?: boolean }) {
  const { t } = useTranslation();
  const window = isTauri() ? getCurrentWindow() : null;
  const updater = useUpdater();
  const [version, setVersion] = useState("");
  const [closeMenuOpen, setCloseMenuOpen] = useState(false);
  const closeMenuRef = useRef<HTMLDivElement>(null);
  const { page, settings, setSettings } = useAppStore();
  const channel = import.meta.env.DEV
    ? "DEV"
    : updater.channel === "store"
      ? "STORE"
      : "RELEASE";
  useEffect(() => {
    if (isTauri()) void getVersion().then(setVersion);
  }, []);
  useEffect(() => {
    if (!closeMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!closeMenuRef.current?.contains(event.target as Node))
        setCloseMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCloseMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMenuOpen]);

  return (
    <div
      data-tauri-drag-region
      className="drag-region relative flex h-9 shrink-0 items-center border-b border-line bg-[#0f1014] pl-3 text-[11px] text-muted"
    >
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-2.5"
      >
        <img
          src={titlebarLogo}
          alt="StreamDash"
          className="h-5 w-auto object-contain"
        />
        <span
          aria-label={t("titleBar.version", { version: version || t("titleBar.loading"), channel })}
          className="flex items-center gap-1 text-[9px] tabular-nums text-zinc-600"
        >
          <Tag size={9} />
          {version ? (
            <span>{version}</span>
          ) : (
            <LoadingIndicator className="h-2 w-7" />
          )}
          <span className="rounded px-1 py-0.5 text-[8px] font-semibold tracking-wider text-zinc-700">
            · {channel}
          </span>
        </span>
      </div>
      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
      <div className="no-drag flex h-full shrink-0 items-center">
        {!setup && <div className="flex items-center gap-0.5 px-1.5">
          {page === "dashboard" && (
            <button
              type="button"
              title={t("titleBar.resetZoom")}
              aria-label={t("titleBar.zoomLabel", { zoom: settings.dashboardZoom })}
              onClick={() => {
                setSettings({ dashboardZoom: 100 });
                void saveSetting("dashboardZoom", 100);
              }}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-zinc-500 transition hover:bg-white/5.5 hover:text-zinc-200"
            >
              <ZoomIn size={13} />
              <span className="min-w-7 text-right text-[10px] tabular-nums">
                {settings.dashboardZoom}%
              </span>
              {settings.dashboardZoom !== 100 && <RotateCcw size={10} />}
            </button>
          )}
          <UpdateControl />
          <div className="hidden items-center gap-0.5 lg:flex">
            <TitleAction
              icon={GitFork}
              label={t("titleBar.openGitHub")}
              onClick={() =>
                void openUrl("https://github.com/Tenkayro/StreamDash")
              }
            />
            <TitleAction
              icon={Bug}
              label={t("titleBar.issues")}
              onClick={() =>
                void openUrl("https://github.com/Tenkayro/StreamDash/issues")
              }
            />
            <TitleAction
              icon={UserRound}
              label={t("titleBar.author")}
              onClick={() => void openUrl("https://github.com/Tenkayro")}
            />
          </div>
        </div>}
        <span className="h-4 w-px bg-line" />
        <button
          aria-label={t("titleBar.minimize")}
          className="grid h-full w-11 place-items-center hover:bg-white/5"
          onClick={() => window?.minimize()}
        >
          <Minus size={13} />
        </button>
        <button
          aria-label={t("titleBar.maximize")}
          className="grid h-full w-11 place-items-center hover:bg-white/5"
          onClick={() => window?.toggleMaximize()}
        >
          <Square size={11} />
        </button>
        <button
          aria-label={t("titleBar.close")}
          className="grid h-full w-11 place-items-center hover:bg-red-600 hover:text-white"
          onClick={() => {
            setCloseMenuOpen(false);
            void window?.close();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setCloseMenuOpen(true);
          }}
        >
          <X size={14} />
        </button>
      </div>
      {closeMenuOpen && (
        <div
          ref={closeMenuRef}
          role="menu"
          aria-label={t("titleBar.closeOptions")}
          className="no-drag absolute right-1 top-[calc(100%+4px)] z-50 w-52 rounded-lg border border-line bg-raised p-1 text-zinc-200 shadow-xl shadow-black/40"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition hover:bg-white/5"
            onClick={() => {
              setCloseMenuOpen(false);
              void window?.hide();
            }}
          >
            <span className="grid size-5 shrink-0 place-items-center text-accent">
              <PanelBottomClose size={13} />
            </span>
            <span className="truncate font-medium">{t("titleBar.closeToTray")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition hover:bg-red-400/10"
            onClick={() => {
              setCloseMenuOpen(false);
              if (isTauri()) void invoke("app_quit");
            }}
          >
            <span className="grid size-5 shrink-0 place-items-center text-red-300">
              <Power size={13} />
            </span>
            <span className="truncate font-medium text-red-200">{t("titleBar.quitApp")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
