import { AlertTriangle, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { needsTwitchPermissionUpdate } from "../services/twitch/client";
import { cn } from "../lib/utils";
import type { ConnectionState } from "../types";
import twitchIcon from "../assets/services/twitch.webp";
import streamElementsIcon from "../assets/services/streamelements.webp";
import { LoadingIndicator } from "./ui";
import { useTranslation } from "react-i18next";
import { navigationGroups, navigationItems, OPEN_COMMAND_PALETTE } from "../lib/navigation";
function Status({
  icon,
  label,
  name,
  state,
}: {
  icon: string;
  label: string;
  name: string;
  state: ConnectionState;
}) {
  const { t } = useTranslation();
  const color =
    state.phase === "connected"
      ? "bg-emerald-400"
      : state.phase === "connecting" || state.phase === "reconnecting"
        ? "bg-amber-400"
        : state.phase === "error" || state.phase === "expired"
          ? "bg-red-400"
          : "bg-zinc-600";
  return (
    <div
      title={`${name}: ${t(`connectionPhases.${state.phase}`)}`}
      className="flex h-8 items-center gap-2"
    >
      <img src={icon} alt="" className="size-4 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
        {["connecting", "reconnecting"].includes(state.phase) &&
        !state.account ? (
          <LoadingIndicator className="h-2.5 w-16" />
        ) : (
          label
        )}
      </span>
      <span className={cn("size-1.5 shrink-0 rounded-full", color)} />
    </div>
  );
}
export function Sidebar() {
  const { t } = useTranslation();
  const { page, setPage, twitch, streamElements, settings, setSettings } =
    useAppStore();
  const collapsed = settings.sidebarCollapsed;
  const permissionAttention =
    twitch.phase === "connected" && needsTwitchPermissionUpdate(twitch.scopes);
  const toggle = () => {
    const value = !collapsed;
    setSettings({ sidebarCollapsed: value });
    void saveSetting("sidebarCollapsed", value).catch(() =>
      setSettings({ sidebarCollapsed: collapsed }),
    );
  };
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-line bg-[#0f1014] p-2 transition-[width]",
        collapsed ? "w-14.5" : "w-52",
      )}
    >
      <button
        type="button"
        title={t("navigation.quickSwitch")}
        aria-label={t("navigation.quickSwitch")}
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
        className={cn(
          "mb-2 flex h-9 w-full items-center rounded-lg border border-line bg-black/15 text-zinc-500 transition hover:border-accent/30 hover:text-zinc-200",
          collapsed ? "justify-center" : "gap-2 px-3",
        )}
      >
        <Search size={15} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-xs">{t("navigation.quickSwitch")}</span>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[9px] text-zinc-600">Ctrl K</kbd>
          </>
        )}
      </button>
      <nav>
        {navigationGroups.map((group, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-3")}>
            {collapsed ? (
              groupIndex > 0 && <div className="mx-2 mb-2 h-px bg-line" />
            ) : (
              <div className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[.14em] text-zinc-700">
                {t(`navigation.${group}`)}
              </div>
            )}
            <div className="space-y-0.5">
              {navigationItems.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => {
          const attention = id === "connections" && permissionAttention;
          const translatedLabel = t(`nav.${label}`);
          return (
            <button
              title={
                attention
                  ? t("nav.permissionAttention")
                  : collapsed
                    ? translatedLabel
                    : undefined
              }
              aria-label={attention ? t("nav.requiredAttention", { label: translatedLabel }) : translatedLabel}
              key={id}
              onClick={() => setPage(id)}
              className={cn(
                "relative flex h-9 w-full items-center rounded-lg text-sm text-zinc-500 transition hover:bg-white/4 hover:text-zinc-200",
                collapsed ? "justify-center" : "gap-3 px-3",
                page === id && "bg-accent-soft text-accent",
              )}
            >
              {page === id && <span className="absolute left-0 h-4 w-0.5 rounded-full bg-accent" />}
              <Icon size={16} />
              {!collapsed && <span className="flex-1 text-left">{translatedLabel}</span>}
              {attention && (
                <AlertTriangle
                  size={14}
                  className={cn(
                    "shrink-0 text-amber-400",
                    settings.animations && "animate-pulse",
                    collapsed &&
                      "absolute -right-0.5 -top-0.5 fill-amber-400/20",
                  )}
                />
              )}
            </button>
          );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto">
        {collapsed ? (
          <div className="mb-2 space-y-1">
            <div
              title={`Twitch: ${t(`connectionPhases.${twitch.phase}`)}`}
              className="flex h-6 items-center justify-center gap-1.5"
            >
              <img
                src={twitchIcon}
                alt="Twitch"
                className="size-4 object-contain"
              />
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  twitch.phase === "connected"
                    ? "bg-emerald-400"
                    : twitch.phase === "connecting" ||
                        twitch.phase === "reconnecting"
                      ? "bg-amber-400"
                      : twitch.phase === "error" || twitch.phase === "expired"
                        ? "bg-red-400"
                        : "bg-zinc-600",
                )}
              />
            </div>
            <div
              title={`StreamElements: ${t(`connectionPhases.${streamElements.phase}`)}`}
              className="flex h-6 items-center justify-center gap-1.5"
            >
              <img
                src={streamElementsIcon}
                alt="StreamElements"
                className="size-4 object-contain"
              />
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  streamElements.phase === "connected"
                    ? "bg-emerald-400"
                    : streamElements.phase === "connecting" ||
                        streamElements.phase === "reconnecting"
                      ? "bg-amber-400"
                      : streamElements.phase === "error" ||
                          streamElements.phase === "expired"
                        ? "bg-red-400"
                        : "bg-zinc-600",
                )}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPage("connections")}
            title={t("navigation.manageConnections")}
            className="mb-2 block w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-left transition hover:border-accent/30 hover:bg-white/[.025]"
          >
            <Status
              icon={twitchIcon}
              name="Twitch"
              label={twitch.account || "Twitch"}
              state={twitch}
            />
            <Status
              icon={streamElementsIcon}
              name="StreamElements"
              label={t("nav.donations")}
              state={streamElements}
            />
          </button>
        )}
        <button
          onClick={toggle}
          title={collapsed ? t("nav.expandNavigation") : t("nav.collapseNavigation")}
          aria-label={collapsed ? t("nav.expandNavigation") : t("nav.collapseNavigation")}
          className={cn(
            "flex h-8 w-full items-center rounded-lg text-xs text-zinc-600 hover:bg-white/4 hover:text-zinc-300",
            collapsed ? "justify-center" : "gap-2 px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen size={15} />
          ) : (
            <>
              <PanelLeftClose size={15} />
              {t("nav.collapse")}
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
