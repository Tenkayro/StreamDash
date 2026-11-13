import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bug,
  Crown,
  Download,
  GitFork,
  LoaderCircle,
  Menu,
  Minus,
  PanelBottomClose,
  Plus,
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
import { useEffect, useLayoutEffect, useRef, useState, type MouseEventHandler } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "../lib/utils";
import { useUpdater } from "../services/updater-context";
import titlebarLogo from "../assets/branding/streamdash-logo-titlebar.webp";
import { LoadingIndicator } from "./ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import pkg from "../../package.json";
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
      className="grid size-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/6 hover:text-zinc-200"
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
  const progress = updater.phase === "installing" ? 100 : updater.progress;

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
            : t("titleBar.downloading", { progress: progress ?? "…" })
        }
        aria-label={
          updater.phase === "installing"
            ? t("titleBar.installing")
            : t("titleBar.downloading", { progress: progress ?? "…" })
        }
        className="relative mx-1 flex h-7 min-w-30 max-w-48 items-center gap-2 overflow-hidden rounded-md border border-accent/30 bg-accent-soft px-2 text-accent"
      >
        {updater.phase === "installing" || progress == null ? (
          <LoaderCircle size={13} className="shrink-0 animate-spin" />
        ) : (
          <Download size={13} className="shrink-0" />
        )}
        <span className="truncate text-[10px] font-medium text-zinc-200">
          {updater.phase === "installing"
            ? t("titleBar.installing")
            : t("titleBar.downloading", { progress })}
        </span>
        <span
          aria-hidden="true"
          className={`absolute bottom-0 left-0 h-0.5 w-full origin-left bg-accent transition-transform duration-300 ${progress == null ? "scale-x-35 animate-pulse" : ""}`}
          style={progress == null ? undefined : { transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})` }}
        />
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
  const [menuPos, setMenuPos] = useState({ right: 0, top: 0 });
  const closeMenuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { settings, setSettings, entitlements } = useAppStore();
  const proActive = entitlements.pro;
  const zoom = Math.max(50, Math.min(150, settings.dashboardZoom || 100));
  const applyZoom = (next: number) => {
    const clamped = Math.max(50, Math.min(150, Math.round(next / 5) * 5));
    if (clamped === zoom) return;
    setSettings({ dashboardZoom: clamped });
    void saveSetting("dashboardZoom", clamped);
  };
  const channel = import.meta.env.DEV
    ? "DEV"
    : updater.channel === "store"
      ? "STORE"
      : "RELEASE";
  useEffect(() => {
    if (isTauri()) void getVersion().then(setVersion);
    else setVersion(pkg.version);
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

  useLayoutEffect(() => {
    if (!closeMenuOpen || !closeButtonRef.current) return;
    const rect = closeButtonRef.current.getBoundingClientRect();
    setMenuPos({
      right: document.documentElement.clientWidth - rect.right,
      top: rect.bottom + 4,
    });
  }, [closeMenuOpen]);

  return (
    <div
      data-tauri-drag-region
      className="app-header-bar drag-region relative flex shrink-0 items-center border-b border-line pl-3 text-[11px] text-muted"
    >
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-2.5"
      >
        {!setup && (
          <button
            type="button"
            aria-label="Menu"
            onClick={() => globalThis.dispatchEvent(new Event("streamdash:toggle-mobile-nav"))}
            className="grid size-7 place-items-center rounded-lg text-zinc-300 hover:bg-white/10 md:hidden"
          >
            <Menu size={16} />
          </button>
        )}
        <img
          src={titlebarLogo}
          alt="StreamDash"
          className="h-5 w-auto object-contain"
        />
        {proActive && (
          <span className="inline-flex items-center gap-1 rounded border border-rule bg-hover px-1.5 py-px text-[10px] font-semibold text-muted">
            <Crown size={9} className="text-amber-300/75" aria-hidden="true" />
            Pro
          </span>
        )}
        <span
          aria-label={t("titleBar.version", { version: version || t("titleBar.loading"), channel })}
          className="flex items-center gap-1 text-[10px] tabular-nums text-subtle"
        >
          <Tag size={9} />
          {version ? (
            <span>{version}</span>
          ) : (
            <LoadingIndicator className="h-2 w-7" />
          )}
          <span className="rounded px-1 py-0.5 text-[10px] font-medium text-subtle">
            {channel.toLowerCase()}
          </span>
        </span>
      </div>
      <div data-tauri-drag-region className="h-full min-w-8 flex-1" />
      <div data-tauri-drag-region="false" className="no-drag flex h-full shrink-0 items-center">
        {!setup && <div className="hidden items-center gap-1 px-1.5 sm:flex">
          <div
            role="group"
            aria-label={t("titleBar.zoomLabel", { zoom })}
            className="flex h-6.5 items-center gap-0.5 rounded-md border border-rule bg-well px-0.5"
          >
            <button
              type="button"
              disabled={zoom <= 50}
              title="-10%"
              aria-label="Zoom out"
              onClick={() => applyZoom(zoom - 10)}
              className="grid size-5 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-35"
            >
              <Minus size={10} />
            </button>
            <button
              type="button"
              title={t("titleBar.resetZoom")}
              aria-label={t("titleBar.zoomLabel", { zoom })}
              onClick={() => applyZoom(100)}
              className={`flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium tabular-nums transition ${
                zoom !== 100
                  ? "bg-accent-soft text-accent hover:brightness-110"
                  : "text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
              }`}
            >
              <ZoomIn size={11} className="shrink-0 opacity-80" />
              <span>{zoom}%</span>
            </button>
            <button
              type="button"
              disabled={zoom >= 150}
              title="+10%"
              aria-label="Zoom in"
              onClick={() => applyZoom(zoom + 10)}
              className="grid size-5 place-items-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-35"
            >
              <Plus size={10} />
            </button>
          </div>
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
        {isTauri() && (
          <>
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
              ref={closeButtonRef}
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
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={(event) => event.stopPropagation()}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
      {closeMenuOpen && createPortal(
        <div
          ref={closeMenuRef}
          data-tauri-drag-region="false"
          role="menu"
          aria-label={t("titleBar.closeOptions")}
          className="fixed z-50 w-max min-w-44 max-w-xs space-y-0.5 rounded-xl border border-rule-strong bg-raised p-1.5 text-[11px] text-ink shadow-xl"
          style={{ right: menuPos.right + 6, top: menuPos.top + 2 }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[11px] transition-colors hover:border-rule hover:bg-hover"
            onClick={() => {
              setCloseMenuOpen(false);
              void window?.hide();
            }}
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-md border border-rule bg-panel text-accent">
              <PanelBottomClose size={11} />
            </span>
            <span className="whitespace-nowrap font-medium">{t("titleBar.closeToTray")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-[11px] transition-colors hover:border-red-400/20 hover:bg-red-400/10"
            onClick={() => {
              setCloseMenuOpen(false);
              if (isTauri()) void invoke("app_quit");
            }}
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-md border border-red-400/15 bg-red-400/10 text-red-300">
              <Power size={11} />
            </span>
            <span className="whitespace-nowrap font-medium text-red-200">{t("titleBar.quitApp")}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
