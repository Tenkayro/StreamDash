import { AlertTriangle, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { needsTwitchPermissionUpdate } from "../services/twitch/client";
import { cn } from "../lib/utils";
import type { ConnectionState } from "../types";
import twitchIcon from "../assets/services/twitch.webp";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import obsIcon from "../assets/services/obs.svg";
import { LoadingIndicator } from "./ui";
import { useTranslation } from "react-i18next";
import { navigationGroups, navigationItems, OPEN_COMMAND_PALETTE } from "../lib/navigation";
function currentTranslateY(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m42;
}
function phaseColor(phase: ConnectionState["phase"]) {
  return phase === "connected"
    ? "bg-emerald-400"
    : phase === "connecting" || phase === "reconnecting"
      ? "bg-amber-400"
      : phase === "error" || phase === "expired"
        ? "bg-red-400"
        : "bg-zinc-600";
}
function Status({
  icon,
  name,
  state,
}: {
  icon: string;
  name: string;
  state: ConnectionState;
}) {
  const { t } = useTranslation();
  return (
    <div
      title={`${name}${state.account ? ` · ${state.account}` : ""}: ${t(`connectionPhases.${state.phase}`)}`}
      className="flex h-6 items-center gap-1.5"
    >
      <img src={icon} alt="" className="size-3.5 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-zinc-300">
        {["connecting", "reconnecting"].includes(state.phase) &&
        !state.account ? (
          <LoadingIndicator className="h-2.5 w-16" />
        ) : (
          name
        )}
      </span>
      <span className={cn("size-1.5 shrink-0 rounded-full", phaseColor(state.phase))} />
    </div>
  );
}
export function Sidebar() {
  const { t } = useTranslation();
  const { page, setPage, twitch, streamElements, tipeeStream, obs, settings, setSettings } =
    useAppStore();
  const collapsed = settings.sidebarCollapsed;
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  const compact = collapsed || narrow;
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorAnimation = useRef<Animation | null>(null);
  const indicatorTop = useRef(0);
  const indicatorReady = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    const active = nav?.querySelector<HTMLElement>('[data-active="true"]');
    if (!nav || !indicator || !active) return;
    const target = active.offsetTop;
    const animated =
      settings.animations &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Start from the element's current on-screen position so rapid clicks
    // continue the motion instead of jumping back to the previous item.
    const from =
      indicatorAnimation.current !== null
        ? currentTranslateY(indicator)
        : indicatorTop.current;

    indicatorAnimation.current?.cancel();
    indicatorAnimation.current = null;
    indicator.style.transform = `translateY(${target}px)`;
    indicatorTop.current = target;

    if (!indicatorReady.current) {
      indicatorReady.current = true;
      return;
    }
    if (!animated || Math.abs(target - from) < 1) return;
    const distance = target - from;
    const overshoot = Math.min(10, Math.abs(distance) * 0.08);
    const animation = indicator.animate(
      [
        { transform: `translateY(${from}px)` },
        { transform: `translateY(${target + overshoot}px)`, offset: 0.6 },
        { transform: `translateY(${target - overshoot * 0.4}px)`, offset: 0.78 },
        { transform: `translateY(${target + overshoot * 0.15}px)`, offset: 0.91 },
        { transform: `translateY(${target}px)` },
      ],
      {
        duration: Math.min(440, 240 + Math.abs(distance) * 1.1),
        easing: "ease-in-out",
      },
    );
    indicatorAnimation.current = animation;
    animation.onfinish = () => {
      if (indicatorAnimation.current === animation)
        indicatorAnimation.current = null;
    };
  }, [page, compact, settings.animations]);
  const services = [
    { name: "Twitch", icon: twitchIcon, state: twitch },
    { name: "StreamElements", icon: streamElementsIcon, state: streamElements },
    { name: "TipeeeStream", icon: tipeeStreamIcon, state: tipeeStream },
    { name: "OBS", icon: obsIcon, state: obs },
  ];
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
        "flex min-h-0 shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-line bg-[#0f1014] p-2 transition-[width]",
        compact ? "w-14.5" : "w-52",
      )}
    >
      <button
        type="button"
        title={t("navigation.quickSwitch")}
        aria-label={t("navigation.quickSwitch")}
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
        className={cn(
          "mb-2 flex h-9 w-full items-center rounded-lg border border-line bg-black/15 text-zinc-500 transition hover:border-accent/30 hover:text-zinc-200",
          compact ? "justify-center" : "gap-2 px-3",
        )}
      >
        <Search size={15} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-xs">{t("navigation.quickSwitch")}</span>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[9px] text-zinc-600">Ctrl K</kbd>
          </>
        )}
      </button>
      <nav ref={navRef} className="relative">
        <span
          aria-hidden="true"
          ref={indicatorRef}
          className="nav-indicator pointer-events-none absolute inset-x-0 top-0 h-9 rounded-lg bg-accent-soft"
        >
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
        </span>
        {navigationGroups.map((group, groupIndex) => (
          <div key={group} className={cn(groupIndex > 0 && "mt-3")}>
            {compact ? (
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
              data-active={page === id ? "true" : undefined}
              title={
                attention
                  ? t("nav.permissionAttention")
                  : compact
                    ? translatedLabel
                    : undefined
              }
              aria-label={attention ? t("nav.requiredAttention", { label: translatedLabel }) : translatedLabel}
              key={id}
              onClick={() => setPage(id)}
              className={cn(
                "relative flex h-9 w-full items-center rounded-lg text-sm text-zinc-500 transition-colors hover:bg-white/4 hover:text-zinc-200",
                compact ? "justify-center" : "gap-3 px-3",
                page === id && "text-accent",
              )}
            >
              <Icon size={16} />
              {!compact && <span className="flex-1 text-left">{translatedLabel}</span>}
              {attention && (
                <AlertTriangle
                  size={14}
                  className={cn(
                    "shrink-0 text-amber-400",
                    settings.animations && "animate-pulse",
                    compact &&
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
        <div className="mx-2 mb-6 mt-2 h-px bg-line" />
        {compact ? (
          <div className="mb-2 space-y-0.5">
            {services.map(({ name, icon, state }) => (
              <div
                key={name}
                title={`${name}: ${t(`connectionPhases.${state.phase}`)}`}
                className="flex h-5 items-center justify-center gap-1.5"
              >
                <img src={icon} alt={name} className="size-3.5 object-contain" />
                <span className={cn("size-1.5 rounded-full", phaseColor(state.phase))} />
              </div>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPage("connections")}
            title={t("navigation.manageConnections")}
            className="mb-2 block w-full rounded-lg border border-line bg-panel px-2 py-1 text-left transition hover:border-accent/30 hover:bg-white/2.5"
          >
            {services.map(({ name, icon, state }) => (
              <Status key={name} icon={icon} name={name} state={state} />
            ))}
          </button>
        )}
        {!narrow && (
          <button
            onClick={toggle}
            title={
              collapsed
                ? t("nav.expandNavigation")
                : t("nav.collapseNavigation")
            }
            aria-label={
              collapsed
                ? t("nav.expandNavigation")
                : t("nav.collapseNavigation")
            }
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
        )}
      </div>
    </aside>
  );
}
