import {
  Activity,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Flag,
  Gift,
  Globe2,
  GripVertical,
  Hash,
  Heart,
  LayoutGrid,
  Link2,
  MessageSquare,
  Minus,
  MonitorPlay,
  MoveDiagonal2,
  Play,
  Plus,
  Radio,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Shuffle,
  Sparkles,
  Square,
  Star,
  Target,
  Terminal,
  Trash2,
  Trophy,
  Users,
  Wallet,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { useAppStore, defaultDashboardWidgets } from "../stores/app-store";
import { saveSetting, twitchNative } from "../services/native";
import { TWITCH_CLIENT_ID } from "../services/twitch/config";
import { useRuntime } from "../services/runtime-context";
import { resolveLanguage } from "../i18n";
import { ActivityFeed } from "../components/ActivityFeed";
import { TwitchPlayer } from "../components/TwitchPlayer";
import { ObsWidget } from "../components/ObsCard";
import {
  Badge,
  Button,
  Card,
  LoadingIndicator,
  PageHeader,
  Toggle,
} from "../components/ui";
import { cn, errorMessage, money } from "../lib/utils";
import type {
  ConnectionState,
  DashboardBrowserSource,
  DashboardItemId,
  DashboardWidgetDimensions,
  DashboardWidgetId,
  DashboardWidgetWidth,
  GiveawayEntry,
} from "../types";
import { useTranslation } from "react-i18next";

type WidgetCatalogEntry = {
  id: DashboardItemId;
  label: string;
  description: string;
};

const widgetCatalog: WidgetCatalogEntry[] = [
  {
    id: "followers",
    label: "Followers",
    description: "Current Twitch followers",
  },
  {
    id: "subscribers",
    label: "Subscribers",
    description: "Current active subscriptions",
  },
  { id: "viewers", label: "Viewers", description: "Current live viewers" },
  {
    id: "duration",
    label: "Stream duration",
    description: "Time since going live",
  },
  { id: "bits", label: "Bits", description: "Locally collected bits" },
  {
    id: "donations",
    label: "Donations",
    description: "Locally collected donations",
  },
  { id: "status", label: "Stream status", description: "Live state and title" },
  {
    id: "eventCount",
    label: "Event count",
    description: "Stored activity total",
  },
  {
    id: "raids",
    label: "Raids",
    description: "Recorded raids and latest raider",
  },
  {
    id: "giftSubs",
    label: "Gifted Subs",
    description: "Total gifted subscriptions",
  },
  {
    id: "chatActivity",
    label: "Chat Messages",
    description: "Stored messages in live chat",
  },
  {
    id: "giveawayCount",
    label: "Giveaway Entries",
    description: "Current giveaway participants",
  },
  {
    id: "activitys",
    label: "Recent activity",
    description: "Latest events at a glance",
  },
  {
    id: "chat",
    label: "Live Chat",
    description: "Read and send chat messages on the dashboard",
  },
  {
    id: "quickActions",
    label: "Quick Actions",
    description: "Stream markers, shortcuts, and deck controls",
  },
  {
    id: "customCounters",
    label: "Custom Counters",
    description: "Adjust custom counters and variables live",
  },
  {
    id: "giveaway",
    label: "Giveaway Control",
    description: "Start giveaways and draw winners",
  },
  {
    id: "commands",
    label: "Chat Commands",
    description: "Toggle commands and view usage counts",
  },
  {
    id: "channelPoints",
    label: "Channel Points",
    description: "Pause or resume custom Twitch rewards",
  },
  {
    id: "streamDetails",
    label: "Stream details",
    description: "Title and category",
  },
  {
    id: "livePreview",
    label: "Live Preview",
    description: "Watch your Twitch stream",
  },
  { id: "goals", label: "Goals", description: "Progress toward your targets" },
  {
    id: "connections",
    label: "Connections",
    description: "Service health and accounts",
  },
  { id: "obs", label: "OBS", description: "Status, scene and audio" },
];

const metricWidgetIds = new Set<DashboardItemId>([
  "followers",
  "subscribers",
  "viewers",
  "duration",
  "bits",
  "donations",
  "status",
  "eventCount",
  "raids",
  "giftSubs",
  "chatActivity",
  "giveawayCount",
]);

const cockpitPresetWidgets: DashboardItemId[] = [
  "viewers",
  "followers",
  "subscribers",
  "duration",
  "status",
  "chatActivity",
  "chat",
  "activitys",
  "quickActions",
  "customCounters",
  "streamDetails",
  "obs",
];

const metricsPresetWidgets: DashboardItemId[] = [
  "followers",
  "subscribers",
  "viewers",
  "duration",
  "bits",
  "donations",
  "status",
  "eventCount",
  "raids",
  "giftSubs",
  "chatActivity",
  "giveawayCount",
  "activitys",
  "goals",
];

function Metric({
  label,
  value,
  note,
  icon: Icon,
  loading = false,
  loadingWidth = "w-14",
}: {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
  loading?: boolean;
  loadingWidth?: string;
}) {
  return (
    <Card className="metric-card flex min-h-0 flex-col">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <span className="metric-icon">
          <Icon size={14} />
        </span>
      </div>
      <div className="metric-value mt-auto pt-2 font-semibold tracking-[-.03em]">
        {loading ? (
          <LoadingIndicator className={`h-6 ${loadingWidth}`} />
        ) : (
          value
        )}
      </div>
      {loading && note !== undefined ? (
        <LoadingIndicator className="mt-1 h-2.5 w-3/5" />
      ) : note ? (
        <div className="mt-0.5 truncate text-[10px] text-zinc-600">{note}</div>
      ) : null}
    </Card>
  );
}

function duration(since?: string) {
  if (!since) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(since).getTime()) / 1000),
  );
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function connectionTone(state: ConnectionState) {
  return state.phase === "connected"
    ? "bg-emerald-400"
    : state.phase === "connecting" || state.phase === "reconnecting"
      ? "bg-amber-400"
      : state.phase === "error" || state.phase === "expired"
        ? "bg-red-400"
        : "bg-zinc-600";
}

function isBrowserWidget(id: DashboardItemId): id is `browser:${string}` {
  return id.startsWith("browser:");
}

function sourceHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function pickWeightedGiveawayWinner(
  entries: GiveawayEntry[],
  subscriberLuck: number,
  currentWinnerLogin?: string,
): GiveawayEntry | undefined {
  if (!entries.length) return undefined;
  const pool =
    entries.length > 1 && currentWinnerLogin
      ? entries.filter((entry) => entry.login !== currentWinnerLogin)
      : entries;
  const weighted: Array<{ entry: GiveawayEntry; weight: number }> = pool.map(
    (entry) => ({
      entry,
      weight: entry.subscriber ? Math.max(1, subscriberLuck) : 1,
    }),
  );
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.entry;
  }
  return weighted[weighted.length - 1]?.entry;
}

function DashboardWidget({
  id,
  editing,
  label,
  width,
  showWidthControls,
  onWidthChange,
  onHide,
  onDelete,
  onMoveStart,
  onResizeStart,
  children,
}: {
  id: DashboardItemId;
  editing: boolean;
  label: string;
  width: DashboardWidgetWidth;
  showWidthControls?: boolean;
  onWidthChange?: (nextWidth: DashboardWidgetWidth) => void;
  onHide: () => void;
  onDelete?: () => void;
  onMoveStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-dashboard-widget={id}
      className={cn(
        "relative h-full min-w-0 rounded-[18px]",
        editing && "ring-1 ring-accent/30",
      )}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2.5 z-20 flex items-center gap-0.5 rounded-full border border-white/12 bg-[#14161c]/92 px-1 py-0.5 shadow-[0_6px_18px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl">
          {showWidthControls && onWidthChange && (
            <div className="flex items-center border-r border-white/10 pr-1 mr-0.5">
              {(
                [
                  ["single", "1x"],
                  ["wide", "2x"],
                  ["full", "Full"],
                ] as const
              ).map(([w, text]) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onWidthChange(w)}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold transition",
                    width === w
                      ? "bg-accent-soft text-accent"
                      : "text-zinc-500 hover:text-zinc-200",
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            title={t("dashboard.moveWidget", { label })}
            aria-label={t("dashboard.moveWidget", { label })}
            onPointerDown={onMoveStart}
            className="grid size-5.5 touch-none cursor-grab place-items-center rounded-full text-zinc-400 outline-none hover:bg-white/10 hover:text-zinc-100 active:cursor-grabbing"
          >
            <GripVertical size={11} />
          </button>
          <button
            type="button"
            title={t("dashboard.hideWidget", { label })}
            aria-label={t("dashboard.hideWidget", { label })}
            onClick={onHide}
            className="grid size-5.5 place-items-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
          >
            <EyeOff size={11} />
          </button>
          {onDelete && (
            <button
              type="button"
              title={t("dashboard.deleteWidget", { label })}
              aria-label={t("dashboard.deleteWidget", { label })}
              onClick={onDelete}
              className="grid size-5.5 place-items-center rounded-full text-zinc-400 hover:bg-red-400/15 hover:text-red-300"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      )}
      <div className="h-full [&>.card]:h-full [&>.card]:overflow-hidden">{children}</div>
      {editing && (
        <button
          type="button"
          title={t("dashboard.resizeWidget", { label })}
          aria-label={t("dashboard.resizeWidget", { label })}
          onPointerDown={onResizeStart}
          className="absolute bottom-2 right-2 z-20 grid size-6 touch-none cursor-se-resize place-items-center rounded-full border border-white/12 bg-[#14161c]/90 text-accent shadow-[0_4px_12px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md outline-none transition hover:border-accent/45 hover:bg-accent-soft"
        >
          <MoveDiagonal2 size={11} />
        </button>
      )}
    </div>
  );
}

function defaultWidgetDimensions(
  id: DashboardItemId,
): DashboardWidgetDimensions {
  if (metricWidgetIds.has(id)) return { width: "single", height: 92 };
  if (id === "activitys") return { width: "wide", height: 288 };
  if (id === "chat") return { width: "wide", height: 288 };
  if (id === "quickActions") return { width: "single", height: 224 };
  if (id === "customCounters") return { width: "single", height: 224 };
  if (id === "giveaway") return { width: "single", height: 224 };
  if (id === "commands") return { width: "single", height: 224 };
  if (id === "channelPoints") return { width: "single", height: 224 };
  if (id === "streamDetails") return { width: "single", height: 224 };
  if (id === "livePreview") return { width: "full", height: 384 };
  if (id === "goals") return { width: "single", height: 224 };
  if (id === "connections") return { width: "single", height: 224 };
  if (id === "obs") return { width: "single", height: 224 };
  return { width: "single", height: 288 };
}

function sameWidgetList(a: DashboardItemId[], b: DashboardItemId[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function packMetricRows(ids: DashboardItemId[], maxCols: number) {
  if (ids.length === 0) return [] as DashboardItemId[][];
  const cols = Math.max(1, Math.min(maxCols, ids.length));
  const rowCount = Math.ceil(ids.length / cols);
  const base = Math.floor(ids.length / rowCount);
  const extra = ids.length % rowCount;
  const rows: DashboardItemId[][] = [];
  let cursor = 0;
  for (let row = 0; row < rowCount; row++) {
    const count = base + (row < extra ? 1 : 0);
    rows.push(ids.slice(cursor, cursor + count));
    cursor += count;
  }
  return rows;
}

interface PackedContentItem {
  id: DashboardItemId;
  units: number;
  height: number;
}

interface PackedContentRow {
  items: PackedContentItem[];
  height: number;
}

function packContentRows(
  ids: DashboardItemId[],
  maxCols: number,
  getDimensions: (id: DashboardItemId) => DashboardWidgetDimensions,
): PackedContentRow[] {
  const rows: PackedContentRow[] = [];
  let current: PackedContentItem[] = [];
  let used = 0;

  const flush = () => {
    if (current.length === 0) return;
    rows.push({
      items: current,
      height: Math.max(...current.map((item) => item.height)),
    });
    current = [];
    used = 0;
  };

  for (const id of ids) {
    const dims = getDimensions(id);
    const units =
      dims.width === "full"
        ? maxCols
        : dims.width === "wide"
          ? Math.min(2, maxCols)
          : 1;
    if (used > 0 && used + units > maxCols) {
      flush();
    }
    current.push({ id, units, height: dims.height });
    used += units;
    if (used >= maxCols) {
      flush();
    }
  }
  flush();
  return rows;
}

function CustomizeToolbar({
  widgets,
  zoom,
  activePreset,
  onShow,
  onApplyPreset,
  onZoomChange,
  onAddBrowser,
  onDeleteBrowser,
  onReset,
}: {
  widgets: WidgetCatalogEntry[];
  zoom: number;
  activePreset: "standard" | "cockpit" | "metrics" | null;
  onShow: (id: DashboardItemId) => void;
  onApplyPreset: (preset: "standard" | "cockpit" | "metrics") => void;
  onZoomChange: (nextZoom: number) => void;
  onAddBrowser: () => void;
  onDeleteBrowser: (id: DashboardItemId) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card mb-2.5 space-y-2 border-dashed p-2.5 transition">
      {/* Top row: Presets + Zoom + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            {t("dashboard.presets.label")}:
          </span>
          {(["standard", "cockpit", "metrics"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition",
                activePreset === preset
                  ? "border-accent/40 bg-accent-soft text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  : "border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-accent/40 hover:text-accent",
              )}
            >
              {t(`dashboard.presets.${preset}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex items-center rounded-full border border-white/[0.08] bg-black/30 p-0.5 shadow-[inset_2px_2px_5px_rgba(0,0,0,0.5)]">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(50, zoom - 10))}
              title={t("dashboard.zoomOut")}
              className="grid size-6 place-items-center rounded-full text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(100)}
              className="px-2 font-mono text-[10px] font-semibold tabular-nums text-zinc-300 hover:text-accent"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(150, zoom + 10))}
              title={t("dashboard.zoomIn")}
              className="grid size-6 place-items-center rounded-full text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
            >
              <ZoomIn size={12} />
            </button>
          </div>

          <button
            type="button"
            title={t("dashboard.addBrowserSource")}
            onClick={onAddBrowser}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/25 px-2.5 text-[10px] text-zinc-300 transition hover:border-accent/50 hover:text-accent"
          >
            <Plus size={11} />
            {t("dashboard.browserSource")}
          </button>

          <button
            type="button"
            title={t("dashboard.resetDashboard")}
            aria-label={t("dashboard.resetDashboard")}
            onClick={onReset}
            className="grid size-7 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-black/25 text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      {/* Bottom row: Hidden widgets */}
      <div className="flex min-h-7 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <EyeOff size={12} />
          {t("dashboard.hidden")}{" "}
          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">
            {widgets.length}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {widgets.length ? (
            widgets.map((widget) => (
              <div
                key={widget.id}
                className="inline-flex h-6.5 overflow-hidden rounded-full border border-white/[0.08] bg-black/25 shadow-[inset_1px_1px_4px_rgba(0,0,0,0.45)] transition hover:border-accent/35"
              >
                <button
                  type="button"
                  title={t("dashboard.showWidget", {
                    label: widget.label,
                    description: widget.description,
                  })}
                  onClick={() => onShow(widget.id)}
                  className="inline-flex items-center gap-1.5 px-2 text-[10px] text-zinc-400 transition hover:text-zinc-100"
                >
                  <Plus size={10} className="text-accent" />
                  {widget.label}
                </button>
                {isBrowserWidget(widget.id) && (
                  <button
                    type="button"
                    title={t("dashboard.deleteWidget", { label: widget.label })}
                    aria-label={t("dashboard.deleteWidget", {
                      label: widget.label,
                    })}
                    onClick={() => onDeleteBrowser(widget.id)}
                    className="grid w-6 place-items-center border-l border-line text-zinc-600 hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            ))
          ) : (
            <span className="text-[10px] text-zinc-600">
              {t("dashboard.hiddenHint")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function BrowserSourceForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const parsed = new URL(url.trim());
      const localHttp =
        parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname);
      if (parsed.protocol !== "https:" && !localHttp)
        throw new Error(t("dashboard.httpsOnly"));
      onAdd(name.trim() || parsed.hostname, parsed.toString());
    } catch (error) {
      toast.error(t("dashboard.invalidSource"), {
        description:
          error instanceof Error ? error.message : t("dashboard.validUrl"),
      });
    }
  };
  return (
    <Card className="mb-3 p-4">
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
          <Globe2 size={14} className="text-accent" />
          {t("dashboard.addBrowserSource")}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(140px,0.35fr)_minmax(260px,1fr)_auto]">
          <input
            className="input"
            value={name}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("dashboard.nameOptional")}
            aria-label={t("dashboard.sourceName")}
          />
          <input
            className="input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/widget"
            aria-label={t("dashboard.sourceUrl")}
            required
          />
          <div className="flex gap-2">
            <Button type="button" onClick={onCancel}>
              {t("dashboard.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("dashboard.add")}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          {t("dashboard.embedHint")}
        </p>
      </form>
    </Card>
  );
}

export function Dashboard() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const {
    stats,
    events,
    settings,
    twitch,
    twitchBot,
    streamElements,
    tipeeStream,
    obs,
    chat,
    chatMessages,
    giveaway,
    commands,
    channelRewards,
    customVariables,
    statsLoading,
    setPage,
    setSettings,
    setGiveaway,
    clearChat,
    toggleCommand,
    upsertChannelReward,
    adjustCustomCounter,
  } = useAppStore();

  const [, tick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [addingBrowserSource, setAddingBrowserSource] = useState(false);
  const [quickChatText, setQuickChatText] = useState("");
  const [sendingQuickChat, setSendingQuickChat] = useState(false);
  const [creatingMarker, setCreatingMarker] = useState(false);
  const [draggedWidget, setDraggedWidget] = useState<DashboardItemId | null>(
    null,
  );
  const [dragOrder, setDragOrder] = useState<DashboardItemId[] | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const dashboardRef = useRef<HTMLDivElement | null>(null);
  const zoomSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;
    const syncWidth = (width: number) => {
      if (width > 0) setContainerWidth(width);
    };
    syncWidth(dashboard.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") syncWidth(width);
    });
    observer.observe(dashboard);
    return () => observer.disconnect();
  }, []);

  const setZoomLevel = (nextZoom: number) => {
    const clamped = Math.max(50, Math.min(150, nextZoom));
    useAppStore.getState().setSettings({ dashboardZoom: clamped });
    clearTimeout(zoomSaveTimer.current);
    zoomSaveTimer.current = setTimeout(() => {
      void saveSetting("dashboardZoom", clamped).catch(() =>
        toast.error(t("dashboard.zoomSaveError")),
      );
    }, 200);
  };

  useEffect(() => {
    const dashboard = dashboardRef.current;
    if (!dashboard) return;
    const handleZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = useAppStore.getState().settings.dashboardZoom;
      const next = Math.max(
        50,
        Math.min(150, current + (event.deltaY < 0 ? 10 : -10)),
      );
      if (next === current) return;
      setZoomLevel(next);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Control")
        dashboard.classList.add("dashboard-zoom-gesture");
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control")
        dashboard.classList.remove("dashboard-zoom-gesture");
    };
    const cancelZoomGesture = () =>
      dashboard.classList.remove("dashboard-zoom-gesture");
    dashboard.addEventListener("wheel", handleZoom, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", cancelZoomGesture);
    return () => {
      dashboard.removeEventListener("wheel", handleZoom);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", cancelZoomGesture);
      clearTimeout(zoomSaveTimer.current);
    };
  }, [t]);

  const connected = [twitch, streamElements, tipeeStream].some(
    (service) => service.phase === "connected",
  );
  const browserWidgets = useMemo<WidgetCatalogEntry[]>(
    () =>
      settings.dashboardBrowserSources.map((source) => ({
        id: `browser:${source.id}`,
        label: source.name,
        description: source.url,
      })),
    [settings.dashboardBrowserSources],
  );
  const availableWidgets = useMemo(
    () => [
      ...widgetCatalog.map((widget) => ({
        ...widget,
        label: t(`dashboard.widgets.${widget.id}.label`),
        description: t(`dashboard.widgets.${widget.id}.description`),
      })),
      ...browserWidgets,
    ],
    [browserWidgets, t],
  );
  const validWidgetIds = useMemo(
    () => new Set(availableWidgets.map((widget) => widget.id)),
    [availableWidgets],
  );
  const widgets = useMemo(
    () =>
      Array.isArray(settings.dashboardWidgets)
        ? [
            ...new Set(
              settings.dashboardWidgets.filter((id) =>
                validWidgetIds.has(id),
              ),
            ),
          ]
        : defaultDashboardWidgets,
    [settings.dashboardWidgets, validWidgetIds],
  );
  const hiddenWidgets = useMemo(
    () => availableWidgets.filter((widget) => !widgets.includes(widget.id)),
    [availableWidgets, widgets],
  );

  const updateWidgets = (next: DashboardItemId[]) => {
    setSettings({ dashboardWidgets: next });
    void saveSetting("dashboardWidgets", next).catch(() =>
      toast.error(t("dashboard.layoutSaveError")),
    );
  };
  const hideWidget = (id: DashboardItemId) =>
    updateWidgets(widgets.filter((widget) => widget !== id));
  const showWidget = (id: DashboardItemId) => updateWidgets([...widgets, id]);

  const applyPreset = (preset: "standard" | "cockpit" | "metrics") => {
    const next =
      preset === "cockpit"
        ? cockpitPresetWidgets
        : preset === "metrics"
          ? metricsPresetWidgets
          : defaultDashboardWidgets;
    setSettings({
      dashboardWidgets: next,
      dashboardWidgetDimensions: {},
    });
    void Promise.all([
      saveSetting("dashboardWidgets", next),
      saveSetting("dashboardWidgetDimensions", {}),
    ]).catch(() => toast.error(t("dashboard.layoutSaveError")));
  };

  const setWidgetWidth = (id: DashboardItemId, width: DashboardWidgetWidth) => {
    const current = dimensionsFor(id);
    const next = {
      ...settings.dashboardWidgetDimensions,
      [id]: { width, height: current.height },
    };
    setSettings({ dashboardWidgetDimensions: next });
    void saveSetting("dashboardWidgetDimensions", next).catch(() =>
      toast.error(t("dashboard.sizeSaveError")),
    );
  };

  const handleCreateStreamMarker = async () => {
    if (!twitch.userId || twitch.phase !== "connected") {
      toast.error(t("stream.notConnected"));
      return;
    }
    if (!stats.live) {
      toast.error(t("dashboard.quickActions.markerOfflineError"));
      return;
    }
    setCreatingMarker(true);
    try {
      await twitchNative.helixPost(TWITCH_CLIENT_ID, "streams/markers", [], {
        user_id: twitch.userId,
        description: "StreamDash Marker",
      });
      toast.success(t("dashboard.quickActions.markerSuccess"));
    } catch (error) {
      toast.error(t("stream.markerError"), {
        description: errorMessage(error),
      });
    } finally {
      setCreatingMarker(false);
    }
  };

  const handleQuickChatSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const msg = quickChatText.trim();
    if (!msg || sendingQuickChat) return;
    setSendingQuickChat(true);
    try {
      await runtime.sendChatMessage(msg);
      setQuickChatText("");
    } catch (error) {
      toast.error(t("chat.sendError"), {
        description: errorMessage(error),
      });
    } finally {
      setSendingQuickChat(false);
    }
  };

  const handleToggleGiveaway = () => {
    const nextRunning = !giveaway.running;
    setGiveaway({ running: nextRunning });
    if (nextRunning && giveaway.chatAnnouncements && twitch.phase === "connected") {
      const lng = resolveLanguage(settings.language);
      const phrase = giveaway.keyword.trim() || "!enter";
      const announcement =
        giveaway.type === "keyword"
          ? i18n.t("giveaways.startAnnouncementKeyword", {
              lng,
              keyword: phrase,
            })
          : i18n.t("giveaways.startAnnouncementActive", { lng });
      void runtime.sendBotChatMessage(announcement).catch(() => undefined);
    }
  };

  const handleDrawGiveawayWinner = () => {
    const chosen = pickWeightedGiveawayWinner(
      giveaway.entries,
      giveaway.subscriberLuck,
      giveaway.winner?.login,
    );
    if (!chosen) return;
    setGiveaway({ winner: chosen });
    if (giveaway.chatAnnouncements && twitch.phase === "connected") {
      const lng = resolveLanguage(settings.language);
      const announcement = i18n.t("giveaways.winnerAnnouncement", {
        lng,
        user: chosen.displayName,
      });
      void runtime.sendBotChatMessage(announcement).catch(() => undefined);
    }
  };

  const startWidgetMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: DashboardItemId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    let order = [...widgets];
    let lastTarget: DashboardItemId | null = null;
    setDraggedWidget(id);
    setDragOrder(order);

    const findWidgetElement = (widgetId: DashboardItemId) =>
      Array.from(
        dashboardRef.current?.querySelectorAll<HTMLElement>(
          "[data-dashboard-drop-id]",
        ) ?? [],
      ).find((element) => element.dataset.dashboardDropId === widgetId);
    const animateElement = (element: HTMLElement, before: DOMRect) => {
      const after = element.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
      element.animate(
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    };
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      const target = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>("[data-dashboard-drop-id]");
      const targetId = target?.dataset.dashboardDropId as
        | DashboardItemId
        | undefined;
      if (
        !targetId ||
        targetId === id ||
        targetId === lastTarget ||
        metricWidgetIds.has(targetId) !== metricWidgetIds.has(id)
      ) {
        if (targetId !== lastTarget) lastTarget = null;
        return;
      }
      const sourceIndex = order.indexOf(id);
      const targetIndex = order.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const sourceElement = findWidgetElement(id);
      const targetElement = findWidgetElement(targetId);
      const sourceRect = sourceElement?.getBoundingClientRect();
      const targetRect = targetElement?.getBoundingClientRect();
      const sourceWidget = order[sourceIndex];
      const targetWidget = order[targetIndex];
      order = order.map((widget, index) =>
        index === sourceIndex
          ? targetWidget
          : index === targetIndex
            ? sourceWidget
            : widget,
      );
      flushSync(() => setDragOrder([...order]));
      const nextSourceElement = findWidgetElement(id);
      const nextTargetElement = findWidgetElement(targetId);
      if (nextSourceElement && sourceRect)
        animateElement(nextSourceElement, sourceRect);
      if (nextTargetElement && targetRect)
        animateElement(nextTargetElement, targetRect);
      lastTarget = targetId;
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDraggedWidget(null);
      setDragOrder(null);
      updateWidgets(order);
    };
    const cancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      setDraggedWidget(null);
      setDragOrder(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const dimensionsFor = (id: DashboardItemId): DashboardWidgetDimensions => {
    const fallback = defaultWidgetDimensions(id);
    const saved = settings.dashboardWidgetDimensions[id];
    if (
      !saved ||
      !["single", "wide", "full"].includes(saved.width) ||
      !Number.isFinite(saved.height)
    )
      return fallback;
    return {
      width: saved.width,
      height: Math.max(80, Math.min(720, saved.height)),
    };
  };

  const startWidgetResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: DashboardItemId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const widget = event.currentTarget.closest<HTMLElement>(
      "[data-dashboard-widget]",
    );
    const item = widget?.parentElement;
    const grid = item?.parentElement;
    const container = dashboardRef.current;
    if (!widget || !item || !grid) return;

    const startRect = item.getBoundingClientRect();
    const containerRect = (container ?? grid).getBoundingClientRect();
    const gridStyle = getComputedStyle(grid);
    const isMetric = metricWidgetIds.has(id);
    const columnCount = isMetric
      ? Math.max(1, Math.min(6, Math.floor((containerWidth + 8) / (180 + 8))))
      : Math.max(1, Math.min(4, Math.floor((containerWidth + 8) / (280 + 8))));
    const scale =
      Math.max(50, Math.min(150, settings.dashboardZoom || 100)) / 100;
    const columnGap = (Number.parseFloat(gridStyle.columnGap) || 8) * scale;
    const cellWidth = Math.max(
      160 * scale,
      (containerRect.width - Math.max(0, columnCount - 1) * columnGap) /
        columnCount,
    );
    const startX = event.clientX;
    const startY = event.clientY;
    let nextWidth = dimensionsFor(id).width;
    let nextHeight = dimensionsFor(id).height;
    const heightSnapCandidates = Array.from(
      (container ?? grid).querySelectorAll<HTMLElement>(
        "[data-dashboard-drop-id]",
      ),
    )
      .filter((element) => element !== item)
      .flatMap((element) => {
        const otherId = element.dataset.dashboardDropId as
          | DashboardItemId
          | undefined;
        if (!otherId) return [];
        const rect = element.getBoundingClientRect();
        const candidates = [
          {
            visual: rect.height,
            logical: dimensionsFor(otherId).height,
          },
        ];
        if (Math.abs(rect.top - startRect.top) <= 4) {
          candidates.push({
            visual: rect.bottom - startRect.top,
            logical: Math.round((rect.bottom - startRect.top) / scale),
          });
        }
        return candidates;
      })
      .filter(
        (candidate) => candidate.logical >= 80 && candidate.logical <= 720,
      );

    const preview = document.createElement("div");
    preview.textContent = `${nextWidth} · ${Math.round(startRect.width / scale)} × ${nextHeight}`;
    Object.assign(preview.style, {
      position: "fixed",
      zIndex: "9999",
      pointerEvents: "none",
      left: `${startRect.left}px`,
      top: `${startRect.top}px`,
      width: `${startRect.width}px`,
      height: `${startRect.height}px`,
      border: "1px solid var(--app-accent)",
      borderRadius: "10px",
      background: "color-mix(in srgb, var(--app-accent) 10%, transparent)",
      color: "#e8e9ed",
      fontSize: "10px",
      padding: "6px 8px",
      boxShadow: "0 12px 32px rgb(0 0 0 / 35%)",
    });
    document.body.append(preview);

    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      pointerEvent.preventDefault();
      const visualWidth = Math.max(
        Math.min(160, containerRect.width),
        Math.min(
          containerRect.right - startRect.left,
          startRect.width + pointerEvent.clientX - startX,
        ),
      );
      const rawVisualHeight = Math.max(
        80 * scale,
        Math.min(720 * scale, startRect.height + pointerEvent.clientY - startY),
      );
      const requestedColumns = Math.max(
        1,
        Math.round((visualWidth + columnGap) / (cellWidth + columnGap)),
      );
      nextWidth =
        requestedColumns >= columnCount
          ? "full"
          : requestedColumns >= 2
            ? "wide"
            : "single";
      const closestHeight = heightSnapCandidates.reduce<
        (typeof heightSnapCandidates)[number] | null
      >(
        (closest, candidate) =>
          Math.abs(candidate.visual - rawVisualHeight) <
          Math.abs(
            (closest?.visual ?? Number.POSITIVE_INFINITY) - rawVisualHeight,
          )
            ? candidate
            : closest,
        null,
      );
      const magneticallySnapped =
        closestHeight !== null &&
        Math.abs(closestHeight.visual - rawVisualHeight) <= 12;
      nextHeight = magneticallySnapped
        ? closestHeight.logical
        : Math.round(rawVisualHeight / scale / 8) * 8;
      const visualHeight = magneticallySnapped
        ? closestHeight.visual
        : nextHeight * scale;
      preview.style.width = `${visualWidth}px`;
      preview.style.height = `${visualHeight}px`;
      preview.style.borderWidth = magneticallySnapped ? "2px" : "1px";
      preview.textContent = `${nextWidth} · ${Math.round(visualWidth / scale)} × ${nextHeight}${magneticallySnapped ? " · aligned" : ""}`;
    };
    const finish = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      preview.remove();
      const current =
        useAppStore.getState().settings.dashboardWidgetDimensions;
      const next = {
        ...current,
        [id]: { width: nextWidth, height: nextHeight },
      };
      setSettings({ dashboardWidgetDimensions: next });
      void saveSetting("dashboardWidgetDimensions", next).catch(() =>
        toast.error(t("dashboard.sizeSaveError")),
      );
    };
    const cancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      preview.remove();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const resetDashboard = () => {
    setSettings({
      dashboardWidgets: defaultDashboardWidgets,
      dashboardWidgetDimensions: {},
    });
    void Promise.all([
      saveSetting("dashboardWidgets", defaultDashboardWidgets),
      saveSetting("dashboardWidgetDimensions", {}),
    ]).catch(() => toast.error(t("dashboard.resetError")));
  };

  const addBrowserSource = (name: string, url: string) => {
    const source: DashboardBrowserSource = {
      id: crypto.randomUUID(),
      name,
      url,
    };
    const sources = [...settings.dashboardBrowserSources, source];
    const widgetId: DashboardItemId = `browser:${source.id}`;
    const nextWidgets: DashboardItemId[] = [...widgets, widgetId];
    setSettings({
      dashboardBrowserSources: sources,
      dashboardWidgets: nextWidgets,
    });
    setAddingBrowserSource(false);
    void Promise.all([
      saveSetting("dashboardBrowserSources", sources),
      saveSetting("dashboardWidgets", nextWidgets),
    ]).catch(() => toast.error(t("dashboard.sourceSaveError")));
  };

  const deleteBrowserSource = (id: DashboardItemId) => {
    if (!isBrowserWidget(id)) return;
    const sourceId = id.slice("browser:".length);
    const sources = settings.dashboardBrowserSources.filter(
      (source) => source.id !== sourceId,
    );
    const nextWidgets = widgets.filter((widget) => widget !== id);
    const dimensions = { ...settings.dashboardWidgetDimensions };
    delete dimensions[id];
    setSettings({
      dashboardBrowserSources: sources,
      dashboardWidgets: nextWidgets,
      dashboardWidgetDimensions: dimensions,
    });
    void Promise.all([
      saveSetting("dashboardBrowserSources", sources),
      saveSetting("dashboardWidgets", nextWidgets),
      saveSetting("dashboardWidgetDimensions", dimensions),
    ]).catch(() => toast.error(t("dashboard.sourceDeleteError")));
  };

  const raidEvents = useMemo(
    () => events.filter((e) => e.eventType === "raid"),
    [events],
  );
  const giftSubTotal = useMemo(
    () =>
      events.reduce(
        (total, event) =>
          total +
          (event.eventType === "community_gift"
            ? (event.giftCount ?? 1)
            : event.eventType === "gift_subscription"
              ? 1
              : 0),
        0,
      ),
    [events],
  );
  const activeChatMessages = useMemo(
    () => chatMessages.filter((m) => !m.deleted),
    [chatMessages],
  );

  const metric = (id: DashboardWidgetId) => {
    if (id === "followers")
      return (
        <Metric
          label={t("dashboard.followers")}
          value={stats.followers?.toLocaleString(i18n.language) ?? "—"}
          loading={statsLoading}
          loadingWidth="w-12"
          icon={Heart}
        />
      );
    if (id === "subscribers")
      return (
        <Metric
          label={t("dashboard.subscribers")}
          value={stats.subscribers?.toLocaleString(i18n.language) ?? "—"}
          loading={statsLoading}
          loadingWidth="w-10"
          icon={Star}
        />
      );
    if (id === "viewers")
      return (
        <Metric
          label={t("dashboard.currentViewers")}
          value={stats.viewers?.toLocaleString(i18n.language) ?? "—"}
          loading={statsLoading}
          loadingWidth="w-11"
          icon={Eye}
        />
      );
    if (id === "duration")
      return (
        <Metric
          label={t("dashboard.streamDuration")}
          value={duration(stats.startedAt)}
          loading={statsLoading}
          loadingWidth="w-20"
          icon={Clock3}
        />
      );
    if (id === "bits")
      return (
        <Metric
          label={t("dashboard.bitsCollected")}
          value={stats.bits.toLocaleString(i18n.language)}
          icon={Sparkles}
        />
      );
    if (id === "donations")
      return (
        <Metric
          label={t("dashboard.donations")}
          value={money(stats.donations, stats.donationCurrency)}
          icon={Wallet}
        />
      );
    if (id === "status")
      return (
        <Metric
          label={t("dashboard.streamStatus")}
          value={stats.live ? t("stream.live") : t("stream.offline")}
          note={statsLoading ? "" : stats.title}
          loading={statsLoading}
          loadingWidth="w-16"
          icon={Radio}
        />
      );
    if (id === "raids")
      return (
        <Metric
          label={t("dashboard.widgets.raids.label")}
          value={raidEvents.length.toLocaleString(i18n.language)}
          note={
            raidEvents[0]
              ? `${raidEvents[0].displayName || raidEvents[0].username} (${raidEvents[0].viewerCount ?? 0})`
              : undefined
          }
          icon={Users}
        />
      );
    if (id === "giftSubs")
      return (
        <Metric
          label={t("dashboard.widgets.giftSubs.label")}
          value={giftSubTotal.toLocaleString(i18n.language)}
          icon={Gift}
        />
      );
    if (id === "chatActivity")
      return (
        <Metric
          label={t("dashboard.widgets.chatActivity.label")}
          value={activeChatMessages.length.toLocaleString(i18n.language)}
          note={t(`connectionPhases.${chat.phase}`)}
          icon={MessageSquare}
        />
      );
    if (id === "giveawayCount")
      return (
        <Metric
          label={t("dashboard.widgets.giveawayCount.label")}
          value={giveaway.entries.length.toLocaleString(i18n.language)}
          note={
            giveaway.winner
              ? `🏆 ${giveaway.winner.displayName}`
              : giveaway.running
                ? t("giveaways.running")
                : t("giveaways.stopped")
          }
          icon={Trophy}
        />
      );
    return (
      <Metric
        label={t("dashboard.activityEvents")}
        value={events.length.toLocaleString(i18n.language)}
        icon={Activity}
      />
    );
  };

  const renderWidget = (id: DashboardItemId) => {
    if (isBrowserWidget(id)) {
      const source = settings.dashboardBrowserSources.find(
        (item) => item.id === id.slice("browser:".length),
      );
      if (!source) return null;
      return (
        <Card className="flex flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <Globe2 size={14} className="shrink-0 text-accent" />
            <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">
              {source.name}
            </h2>
            <span className="max-w-1/2 truncate text-[9px] text-zinc-600">
              {sourceHostname(source.url)}
            </span>
          </div>
          <iframe
            src={source.url}
            title={source.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            allow="autoplay; fullscreen"
            allowFullScreen
            className="min-h-0 w-full flex-1 border-0 bg-black"
          />
        </Card>
      );
    }

    if (metricWidgetIds.has(id)) {
      return metric(id as DashboardWidgetId);
    }

    if (id === "activitys")
      return (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-xs font-semibold">
              {t("dashboard.recentActivity")}
            </h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("activitys")}
            >
              {t("dashboard.viewAll")}
            </button>
          </div>
          <ActivityFeed
            events={events}
            limit={settings.uiDensity === "compact" ? 5 : 7}
            compact={settings.compactFeed || settings.uiDensity === "compact"}
          />
        </Card>
      );

    if (id === "chat") {
      const recentChat = activeChatMessages.slice(-25);
      return (
        <Card className="flex flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <MessageSquare size={14} className="text-accent" />
              {t("dashboard.widgets.chat.label")}
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  connectionTone(chat),
                )}
              />
            </div>
            <button
              type="button"
              onClick={() => setPage("chat")}
              className="text-[11px] text-accent hover:brightness-125"
            >
              {t("dashboard.open")}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3.5 py-2.5 text-xs">
            {recentChat.length === 0 ? (
              <div className="grid h-full place-items-center text-center text-[11px] text-muted">
                {t("chat.waitingFirstMessage")}
              </div>
            ) : (
              recentChat.map((msg) => (
                <div key={msg.id} className="leading-relaxed wrap-break-word">
                  {settings.chatTimestamps && (
                    <span className="mr-1.5 font-mono text-[10px] text-zinc-600">
                      {new Date(msg.timestamp).toLocaleTimeString(
                        i18n.language,
                        {
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}
                    </span>
                  )}
                  <span
                    className="font-semibold"
                    style={{ color: msg.color || "#fb923c" }}
                  >
                    {msg.displayName}:
                  </span>{" "}
                  <span className="text-zinc-200">{msg.text}</span>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={handleQuickChatSubmit}
            className="flex shrink-0 items-center gap-1.5 border-t border-line p-2"
          >
            <input
              className="input h-7 flex-1 text-xs"
              value={quickChatText}
              onChange={(event) => setQuickChatText(event.target.value)}
              placeholder={
                twitch.phase === "connected"
                  ? t("giveaways.chatPlaceholder")
                  : t("stream.notConnected")
              }
              disabled={twitch.phase !== "connected" || sendingQuickChat}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={
                twitch.phase !== "connected" ||
                !quickChatText.trim() ||
                sendingQuickChat
              }
              className="h-7 px-2.5"
            >
              <Send size={12} />
            </Button>
          </form>
        </Card>
      );
    }

    if (id === "quickActions") {
      return (
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Zap size={14} className="text-accent" />
              {t("dashboard.widgets.quickActions.label")}
            </div>
            <button
              type="button"
              onClick={() => setPage("variables")}
              className="text-[11px] text-accent hover:brightness-125"
            >
              {t("nav.variables")}
            </button>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={creatingMarker}
              onClick={() => void handleCreateStreamMarker()}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent disabled:opacity-50"
            >
              <Flag size={13} className="shrink-0 text-accent" />
              <span className="truncate">{t("dashboard.quickActions.marker")}</span>
            </button>
            <button
              type="button"
              onClick={handleToggleGiveaway}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <Gift size={13} className="shrink-0 text-accent" />
              <span className="truncate">
                {giveaway.running
                  ? t("dashboard.quickActions.stopGiveaway")
                  : t("dashboard.quickActions.startGiveaway")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!twitch.account) {
                  toast.error(t("stream.notConnected"));
                  return;
                }
                void navigator.clipboard.writeText(
                  `https://twitch.tv/${twitch.account}`,
                );
                toast.success(t("dashboard.quickActions.channelCopied"));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <Copy size={13} className="shrink-0 text-accent" />
              <span className="truncate">
                {t("dashboard.quickActions.copyChannel")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                clearChat();
                toast.success(t("dashboard.quickActions.chatCleared"));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <Trash2 size={13} className="shrink-0 text-accent" />
              <span className="truncate">
                {t("dashboard.quickActions.clearChat")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                void runtime.reconnect();
                toast.success(t("dashboard.quickActions.reconnecting"));
              }}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <RefreshCw size={13} className="shrink-0 text-accent" />
              <span className="truncate">
                {t("dashboard.quickActions.reconnect")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPage("stream")}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-white/2 px-2.5 py-2 text-left text-[11px] font-medium text-zinc-200 transition hover:border-accent/40 hover:bg-accent-soft hover:text-accent"
            >
              <RadioTower size={13} className="shrink-0 text-accent" />
              <span className="truncate">{t("nav.stream")}</span>
            </button>
          </div>
        </Card>
      );
    }

    if (id === "customCounters") {
      const counters = customVariables.filter((v) => v.type === "counter");
      return (
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Hash size={14} className="text-accent" />
              {t("dashboard.widgets.customCounters.label")}
            </div>
            <button
              type="button"
              onClick={() => setPage("variables")}
              className="text-[11px] text-accent hover:brightness-125"
            >
              {t("dashboard.manage")}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {counters.length === 0 ? (
              <div className="grid h-full place-items-center text-center">
                <div className="space-y-2">
                  <div className="text-[11px] text-muted">
                    {t("variables.noCustomVariables")}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPage("variables")}
                    className="inline-flex items-center gap-1 rounded-lg border border-accent/35 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent transition hover:brightness-110"
                  >
                    <Plus size={12} />
                    {t("variables.addCustom")}
                  </button>
                </div>
              </div>
            ) : (
              counters.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-semibold text-accent">
                      {`$(${item.name})`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="mr-1 font-mono text-sm font-bold tabular-nums text-zinc-100">
                      {item.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustCustomCounter(item.id, -1)}
                      className="grid size-6 place-items-center rounded-md border border-line bg-black/25 text-zinc-300 hover:border-white/25 hover:text-white"
                    >
                      <Minus size={11} />
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustCustomCounter(item.id, 1)}
                      className="grid size-6 place-items-center rounded-md border border-accent/35 bg-accent-soft text-accent hover:border-accent"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      );
    }

    if (id === "giveaway") {
      return (
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Gift size={14} className="text-accent" />
              {t("nav.giveaways")}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={giveaway.running ? "green" : "neutral"}>
                {giveaway.running
                  ? t("giveaways.running")
                  : t("giveaways.stopped")}
              </Badge>
              <button
                type="button"
                onClick={() => setPage("giveaways")}
                className="text-[11px] text-accent hover:brightness-125"
              >
                {t("dashboard.open")}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white/2 p-2.5 text-xs">
            <div>
              <div className="text-[10px] text-muted">
                {t("giveaways.users")}
              </div>
              <div className="mt-0.5 text-sm font-bold tabular-nums text-zinc-100">
                {giveaway.entries.length}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted">
                {t("giveaways.winnerTitle")}
              </div>
              <div className="mt-0.5 truncate text-xs font-semibold text-accent">
                {giveaway.winner?.displayName ?? "—"}
              </div>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2 pt-3">
            <Button
              variant={giveaway.running ? "default" : "primary"}
              onClick={handleToggleGiveaway}
              className="flex-1 justify-center"
            >
              {giveaway.running ? <Square size={12} /> : <Play size={12} />}
              {giveaway.running
                ? t("dashboard.quickActions.stopGiveaway")
                : t("dashboard.quickActions.startGiveaway")}
            </Button>
            <Button
              onClick={handleDrawGiveawayWinner}
              disabled={giveaway.entries.length === 0}
              className="flex-1 justify-center"
            >
              <Shuffle size={12} />
              {t("giveaways.rollIt")}
            </Button>
          </div>
        </Card>
      );
    }

    if (id === "commands") {
      return (
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Terminal size={14} className="text-accent" />
              {t("nav.commands")}
            </div>
            <button
              type="button"
              onClick={() => setPage("commands")}
              className="text-[11px] text-accent hover:brightness-125"
            >
              {t("dashboard.manage")}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {commands.slice(0, 6).map((cmd) => {
              const trigger = cmd.usePrefix ? `!${cmd.name}` : cmd.name;
              return (
                <div
                  key={cmd.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/2 px-2.5 py-1.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-mono font-semibold text-zinc-100">
                      {trigger}
                    </span>
                    {cmd.usageCount ? (
                      <span className="ml-2 text-[10px] text-muted">
                        ×{cmd.usageCount}
                      </span>
                    ) : null}
                  </div>
                  <Toggle
                    value={cmd.enabled}
                    onChange={(enabled) => toggleCommand(cmd.id, enabled)}
                    label={trigger}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      );
    }

    if (id === "channelPoints") {
      return (
        <Card className="flex flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Sparkles size={14} className="text-accent" />
              {t("nav.channelPoints")}
            </div>
            <button
              type="button"
              onClick={() => setPage("channelPoints")}
              className="text-[11px] text-accent hover:brightness-125"
            >
              {t("dashboard.manage")}
            </button>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
            {channelRewards.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-muted">
                {t("channelPoints.emptyTitle")}
              </div>
            ) : (
              channelRewards.slice(0, 5).map((reward) => (
                <div
                  key={reward.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/2 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: reward.backgroundColor }}
                    />
                    <span className="truncate font-medium text-zinc-100">
                      {reward.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {reward.cost.toLocaleString(i18n.language)}
                    </span>
                  </div>
                  <Toggle
                    value={reward.enabled && !reward.paused}
                    onChange={(active) => {
                      const prev = reward;
                      const next = {
                        ...reward,
                        enabled: active,
                        paused: !active,
                      };
                      upsertChannelReward(next);
                      const canManage =
                        twitch.phase === "connected" &&
                        Boolean(twitch.userId) &&
                        Boolean(reward.manageable) &&
                        Boolean(twitch.scopes?.includes("channel:manage:redemptions"));
                      if (canManage && twitch.userId) {
                        void twitchNative
                          .helixPatch(
                            TWITCH_CLIENT_ID,
                            "channel_points/custom_rewards",
                            [
                              ["broadcaster_id", twitch.userId],
                              ["id", reward.id],
                            ],
                            { is_enabled: active, is_paused: !active },
                          )
                          .catch((error) => {
                            upsertChannelReward(prev);
                            toast.error(t("channelPoints.saveError"), {
                              description: errorMessage(error),
                            });
                          });
                      }
                    }}
                    label={reward.title}
                  />
                </div>
              ))
            )}
          </div>
        </Card>
      );
    }

    if (id === "streamDetails")
      return (
        <Card className="flex flex-col p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold">
              {t("dashboard.streamDetails")}
            </h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("stream")}
            >
              {t("dashboard.edit")}
            </button>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[10px] text-muted">
                {t("dashboard.streamTitle")}
              </div>
              <div className="mt-1 text-xs">
                {statsLoading ? (
                  <LoadingIndicator className="h-3.5 w-4/5" />
                ) : (
                  stats.title || t("dashboard.noStreamInfo")
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted">
                {t("stream.category")}
              </div>
              <div className="mt-1 text-xs">
                {statsLoading ? (
                  <LoadingIndicator className="h-3.5 w-24" />
                ) : (
                  stats.category || "—"
                )}
              </div>
            </div>
          </div>
        </Card>
      );

    if (id === "livePreview")
      return (
        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <MonitorPlay size={14} className="text-accent" />
              {t("nav.livePreview")}
            </div>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("livePreview")}
            >
              {t("dashboard.open")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-black">
            <TwitchPlayer className="h-full w-full" />
          </div>
        </Card>
      );

    if (id === "goals") {
      const goals = [
        {
          label: t("dashboard.followers"),
          value: stats.followers,
          target: settings.goals.followers,
          loading: statsLoading,
        },
        {
          label: t("dashboard.subscribers"),
          value: stats.subscribers,
          target: settings.goals.subscribers,
          loading: statsLoading,
        },
        {
          label: t("dashboard.donations"),
          value: stats.donations,
          target: settings.goals.donations,
          loading: false,
        },
        {
          label: t("goals.bits"),
          value: stats.bits,
          target: settings.goals.bits,
          loading: false,
        },
        {
          label: t("goals.raids"),
          value: raidEvents.length,
          target: settings.goals.raids,
          loading: false,
        },
        {
          label: t("goals.giftSubscriptions"),
          value: giftSubTotal,
          target: settings.goals.giftSubscriptions,
          loading: false,
        },
      ];
      const configuredGoals = goals.filter((goal) => goal.target);
      return (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Target size={14} className="text-accent" />
              {t("nav.goals")}
            </div>
            <button
              className="text-[11px] text-accent"
              onClick={() => setPage("goals")}
            >
              {t("dashboard.manage")}
            </button>
          </div>
          <div className="space-y-3">
            {!configuredGoals.length && (
              <div className="py-5 text-center text-[11px] leading-5 text-muted">
                {t("goals.configureHint")}
              </div>
            )}
            {configuredGoals.slice(0, 3).map((goal) => {
              const percent =
                goal.value != null && goal.target
                  ? Math.min(100, (goal.value / goal.target) * 100)
                  : 0;
              return (
                <div key={goal.label}>
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-muted">{goal.label}</span>
                    {goal.loading ? (
                      <LoadingIndicator className="h-2.5 w-10" />
                    ) : (
                      <span>
                        {goal.target
                          ? `${Math.round(percent)}%`
                          : t("goals.noTarget")}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    {goal.loading ? (
                      <LoadingIndicator className="h-full w-2/5" />
                    ) : (
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {configuredGoals.length > 3 && (
              <button
                type="button"
                onClick={() => setPage("goals")}
                className="text-[10px] text-accent hover:brightness-125"
              >
                {t("goals.moreGoals", { count: configuredGoals.length - 3 })}
              </button>
            )}
          </div>
        </Card>
      );
    }

    if (id === "obs") return <ObsWidget />;

    return (
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Link2 size={14} className="text-accent" />
            {t("nav.connections")}
          </div>
          <button
            className="text-[11px] text-accent"
            onClick={() => setPage("connections")}
          >
            {t("dashboard.manage")}
          </button>
        </div>
        {[
          ["Twitch", twitch],
          [t("connections.twitchBot"), twitchBot],
          ["StreamElements", streamElements],
          ["TipeeeStream", tipeeStream],
          ["OBS", obs],
        ].map(([name, state]) => {
          const service = state as ConnectionState;
          return (
            <div
              key={name as string}
              className="flex items-center justify-between border-t border-line py-2.5 first:border-0"
            >
              <div>
                <div className="text-xs">{name as string}</div>
                <div className="text-[10px] text-zinc-600">
                  {["connecting", "reconnecting"].includes(service.phase) &&
                  !service.account ? (
                    <LoadingIndicator className="h-2.5 w-16" />
                  ) : (
                    service.account || t(`connectionPhases.${service.phase}`)
                  )}
                </div>
              </div>
              <span
                className={`size-2 rounded-full ${connectionTone(service)}`}
              />
            </div>
          );
        })}
      </Card>
    );
  };

  const zoom = Math.max(50, Math.min(150, settings.dashboardZoom || 100));
  const displayedWidgets = dragOrder ?? widgets;
  const visibleMetricWidgets = displayedWidgets.filter((id) =>
    metricWidgetIds.has(id),
  );
  const visibleContentWidgets = displayedWidgets.filter(
    (id) => !metricWidgetIds.has(id),
  );
  const maxMetricCols = Math.max(
    1,
    Math.min(6, Math.floor((containerWidth + 8) / (180 + 8))),
  );
  const maxContentCols = Math.max(
    1,
    Math.min(4, Math.floor((containerWidth + 8) / (280 + 8))),
  );
  const metricRows = packMetricRows(visibleMetricWidgets, maxMetricCols);
  const contentRows = packContentRows(
    visibleContentWidgets,
    maxContentCols,
    dimensionsFor,
  );
  const activePreset = sameWidgetList(widgets, defaultDashboardWidgets)
    ? "standard"
    : sameWidgetList(widgets, cockpitPresetWidgets)
      ? "cockpit"
      : sameWidgetList(widgets, metricsPresetWidgets)
        ? "metrics"
        : null;

  return (
    <div
      ref={dashboardRef}
      className={cn(draggedWidget && "[&_iframe]:pointer-events-none")}
      style={{ zoom: zoom / 100, width: `${10_000 / zoom}%` }}
    >
      <PageHeader
        icon={LayoutGrid}
        title={t("nav.dashboard")}
        description={t("pageDescriptions.dashboard")}
        titleActions={
          <button
            onClick={() => setEditing(!editing)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition ${editing ? "bg-accent-soft text-accent" : "text-zinc-600 hover:bg-white/4 hover:text-zinc-300"}`}
          >
            {editing ? <LayoutGrid size={12} /> : <Settings2 size={12} />}{" "}
            {editing ? t("dashboard.finish") : t("dashboard.customize")}
          </button>
        }
        actions={
          statsLoading ? (
            <LoadingIndicator className="h-6 w-16" />
          ) : (
            <Badge
              tone={stats.live ? "green" : connected ? "neutral" : "amber"}
            >
              {stats.live
                ? t("stream.live")
                : connected
                  ? t("stream.offline")
                  : t("connectionPhases.disconnected")}
            </Badge>
          )
        }
      />
      {editing && addingBrowserSource && (
        <BrowserSourceForm
          onAdd={addBrowserSource}
          onCancel={() => setAddingBrowserSource(false)}
        />
      )}
      {editing && (
        <CustomizeToolbar
          widgets={hiddenWidgets}
          zoom={zoom}
          activePreset={activePreset}
          onShow={showWidget}
          onApplyPreset={applyPreset}
          onZoomChange={setZoomLevel}
          onAddBrowser={() => setAddingBrowserSource(true)}
          onDeleteBrowser={deleteBrowserSource}
          onReset={resetDashboard}
        />
      )}
      {metricRows.length > 0 && (
        <div className="dashboard-metrics space-y-2">
          {metricRows.map((row, rowIndex) => {
            const rowHeight = Math.max(
              ...row.map((id) => dimensionsFor(id).height),
            );
            return (
              <div
                key={`metric-row-${rowIndex}`}
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))`,
                }}
              >
                {row.map((id) => {
                  const label =
                    availableWidgets.find((widget) => widget.id === id)
                      ?.label ?? t("dashboard.widget");
                  const dimensions = dimensionsFor(id);
                  return (
                    <div
                      key={id}
                      data-dashboard-drop-id={id}
                      className={cn(
                        "min-w-0 rounded-[18px] transition",
                        draggedWidget === id && "ring-2 ring-accent/60",
                      )}
                      style={{ height: rowHeight }}
                    >
                      <DashboardWidget
                        id={id}
                        editing={editing}
                        label={label}
                        width={dimensions.width}
                        onHide={() => hideWidget(id)}
                        onMoveStart={(event) => startWidgetMove(event, id)}
                        onResizeStart={(event) => startWidgetResize(event, id)}
                      >
                        {renderWidget(id)}
                      </DashboardWidget>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {contentRows.length > 0 && (
        <div
          className={cn(
            "dashboard-content space-y-2",
            metricRows.length > 0 && "mt-2",
          )}
        >
          {contentRows.map((row, rowIndex) => (
            <div
              key={`content-row-${rowIndex}`}
              className="grid gap-2"
              style={{
                gridTemplateColumns: row.items
                  .map((item) => `minmax(0, ${item.units}fr)`)
                  .join(" "),
              }}
            >
              {row.items.map(({ id }) => {
                const label =
                  availableWidgets.find((widget) => widget.id === id)?.label ??
                  t("dashboard.widget");
                const dimensions = dimensionsFor(id);
                return (
                  <div
                    key={id}
                    data-dashboard-drop-id={id}
                    className={cn(
                      "min-w-0 rounded-xl transition",
                      draggedWidget === id && "ring-2 ring-accent/60",
                    )}
                    style={{ height: row.height }}
                  >
                    <DashboardWidget
                      id={id}
                      editing={editing}
                      label={label}
                      width={dimensions.width}
                      showWidthControls
                      onWidthChange={(w) => setWidgetWidth(id, w)}
                      onHide={() => hideWidget(id)}
                      onMoveStart={(event) => startWidgetMove(event, id)}
                      onResizeStart={(event) => startWidgetResize(event, id)}
                      onDelete={
                        isBrowserWidget(id)
                          ? () => deleteBrowserSource(id)
                          : undefined
                      }
                    >
                      {renderWidget(id)}
                    </DashboardWidget>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {widgets.length === 0 && (
        <Card className="grid min-h-52 place-items-center text-center">
          <div>
            <LayoutGrid size={24} className="mx-auto text-zinc-600" />
            <div className="mt-3 text-sm font-medium">
              {t("dashboard.empty")}
            </div>
            {!editing && (
              <button
                className="mt-2 text-xs text-accent"
                onClick={() => setEditing(true)}
              >
                {t("dashboard.addWidgets")}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
