import {
  Activity,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  Heart,
  LayoutGrid,
  Link2,
  MonitorPlay,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  Sparkles,
  Star,
  Target,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useAppStore, defaultDashboardWidgets } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { ActivityFeed } from "../components/ActivityFeed";
import { TwitchPlayer } from "../components/TwitchPlayer";
import {
  Badge,
  Button,
  Card,
  LoadingIndicator,
  PageHeader,
} from "../components/ui";
import { cn, money } from "../lib/utils";
import type {
  ConnectionState,
  DashboardBrowserSource,
  DashboardItemId,
  DashboardWidgetId,
} from "../types";

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
    id: "activity",
    label: "Recent activity",
    description: "Latest events at a glance",
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
]);

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
    <Card className="flex min-h-0 flex-col p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        <Icon size={14} className="text-zinc-600" />
      </div>
      <div className="mt-auto pt-2 text-xl font-semibold tracking-[-.03em]">
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

function DashboardWidget({
  editing,
  label,
  onHide,
  onDelete,
  children,
}: {
  editing: boolean;
  label: string;
  onHide: () => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative h-full min-w-0", editing && "ring-1 ring-accent/25")}>
      {editing && (
        <div className="absolute -top-2 right-2 z-20 flex items-center rounded-md border border-line bg-raised shadow-lg">
          <button
            type="button"
            title={`Hide ${label}`}
            aria-label={`Hide ${label}`}
            onClick={onHide}
            className="grid size-6 place-items-center text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <EyeOff size={12} />
          </button>
          {onDelete && (
            <button
              type="button"
              title={`Delete ${label}`}
              aria-label={`Delete ${label}`}
              onClick={onDelete}
              className="grid size-6 place-items-center border-l border-line text-zinc-500 hover:bg-red-400/10 hover:text-red-300"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
      <div className="h-full overflow-hidden [&>.card]:h-full">{children}</div>
    </div>
  );
}

function widgetLayoutClass(id: DashboardItemId) {
  if (id === "activity") return "min-h-72 lg:col-span-2";
  if (id === "streamDetails") return "min-h-56";
  if (id === "livePreview") return "col-span-full min-h-96";
  if (id === "goals" || id === "connections") return "min-h-52";
  return "min-h-80";
}

function HiddenWidgets({
  widgets,
  onShow,
  onAddBrowser,
  onDeleteBrowser,
  onReset,
}: {
  widgets: WidgetCatalogEntry[];
  onShow: (id: DashboardItemId) => void;
  onAddBrowser: () => void;
  onDeleteBrowser: (id: DashboardItemId) => void;
  onReset: () => void;
}) {
  return (
    <div
      className="card mb-2 flex min-h-10 items-center gap-2 border-dashed px-2.5 py-1.5 transition"
    >
      <div className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-zinc-500">
        <EyeOff size={13} />
        Hidden{" "}
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-600">
          {widgets.length}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {widgets.length ? (
          widgets.map((widget) => (
            <div
              key={widget.id}
              className="inline-flex h-7 overflow-hidden rounded-md border border-line bg-black/15"
            >
              <button
                title={`Show ${widget.label} - ${widget.description}`}
                onClick={() => onShow(widget.id)}
                className="inline-flex items-center gap-1.5 px-2 text-[10px] text-zinc-500 transition hover:text-zinc-200"
              >
                <Eye size={11} />
                {widget.label}
              </button>
              {isBrowserWidget(widget.id) && (
                <button
                  type="button"
                  title={`Delete ${widget.label}`}
                  aria-label={`Delete ${widget.label}`}
                  onClick={() => onDeleteBrowser(widget.id)}
                  className="grid w-7 place-items-center border-l border-line text-zinc-600 hover:bg-red-400/10 hover:text-red-300"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))
        ) : (
          <span className="text-[10px] text-zinc-700">
            Hidden widgets appear here
          </span>
        )}
      </div>
      <button
        type="button"
        title="Add browser source"
        onClick={onAddBrowser}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-black/15 px-2 text-[10px] text-zinc-400 transition hover:border-accent/50 hover:text-accent"
      >
        <Plus size={11} />
        Browser source
      </button>
      <button
        title="Reset dashboard"
        aria-label="Reset dashboard"
        onClick={onReset}
        className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
      >
        <RotateCcw size={13} />
      </button>
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
        throw new Error("Use an HTTPS URL or a local development address");
      onAdd(name.trim() || parsed.hostname, parsed.toString());
    } catch (error) {
      toast.error("Invalid browser source", {
        description:
          error instanceof Error ? error.message : "Enter a valid URL",
      });
    }
  };
  return (
    <Card className="mb-3 p-4">
      <form onSubmit={submit}>
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold">
          <Globe2 size={14} className="text-accent" />
          Add browser source
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(140px,0.35fr)_minmax(260px,1fr)_auto]">
          <input
            className="input"
            value={name}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Browser source name"
          />
          <input
            className="input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/widget"
            aria-label="Browser source URL"
            required
          />
          <div className="flex gap-2">
            <Button type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Add
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-zinc-600">
          Some websites block embedding. HTTPS and local development URLs are
          supported.
        </p>
      </form>
    </Card>
  );
}

export function Dashboard() {
  const {
    stats,
    events,
    settings,
    twitch,
    streamElements,
    statsLoading,
    setPage,
    setSettings,
  } = useAppStore();
  const [, tick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [addingBrowserSource, setAddingBrowserSource] = useState(false);
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
    const handleZoom = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const current = useAppStore.getState().settings.dashboardZoom;
      const next = Math.max(
        50,
        Math.min(150, current + (event.deltaY < 0 ? 10 : -10)),
      );
      if (next === current) return;
      useAppStore.getState().setSettings({ dashboardZoom: next });
      clearTimeout(zoomSaveTimer.current);
      zoomSaveTimer.current = setTimeout(() => {
        void saveSetting("dashboardZoom", next).catch(() =>
          toast.error("Dashboard zoom could not be saved"),
        );
      }, 200);
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
  }, []);
  const connected =
    twitch.phase === "connected" || streamElements.phase === "connected";
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
    () => [...widgetCatalog, ...browserWidgets],
    [browserWidgets],
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
      toast.error("Dashboard layout could not be saved"),
    );
  };
  const hideWidget = (id: DashboardItemId) =>
    updateWidgets(widgets.filter((widget) => widget !== id));
  const showWidget = (id: DashboardItemId) => updateWidgets([...widgets, id]);
  const resetDashboard = () => {
    setSettings({
      dashboardWidgets: defaultDashboardWidgets,
    });
    void saveSetting("dashboardWidgets", defaultDashboardWidgets).catch(() =>
      toast.error("Dashboard layout could not be reset"),
    );
  };
  const addBrowserSource = (name: string, url: string) => {
    const source: DashboardBrowserSource = {
      id: crypto.randomUUID(),
      name,
      url,
    };
    const sources = [...settings.dashboardBrowserSources, source];
    const widgetId: DashboardItemId = `browser:${source.id}`;
    const nextWidgets: DashboardItemId[] = [
      ...widgets,
      widgetId,
    ];
    setSettings({
      dashboardBrowserSources: sources,
      dashboardWidgets: nextWidgets,
    });
    setAddingBrowserSource(false);
    void Promise.all([
      saveSetting("dashboardBrowserSources", sources),
      saveSetting("dashboardWidgets", nextWidgets),
    ]).catch(() => toast.error("Browser source could not be saved"));
  };
  const deleteBrowserSource = (id: DashboardItemId) => {
    if (!isBrowserWidget(id)) return;
    const sourceId = id.slice("browser:".length);
    const sources = settings.dashboardBrowserSources.filter(
      (source) => source.id !== sourceId,
    );
    const nextWidgets = widgets.filter((widget) => widget !== id);
    setSettings({
      dashboardBrowserSources: sources,
      dashboardWidgets: nextWidgets,
    });
    void Promise.all([
      saveSetting("dashboardBrowserSources", sources),
      saveSetting("dashboardWidgets", nextWidgets),
    ]).catch(() => toast.error("Browser source could not be deleted"));
  };
  const metric = (id: DashboardWidgetId) => {
    if (id === "followers")
      return (
        <Metric
          label="Followers"
          value={stats.followers?.toLocaleString("en-US") ?? "—"}
          loading={statsLoading}
          loadingWidth="w-12"
          icon={Heart}
        />
      );
    if (id === "subscribers")
      return (
        <Metric
          label="Subscribers"
          value={stats.subscribers?.toLocaleString("en-US") ?? "—"}
          loading={statsLoading}
          loadingWidth="w-10"
          icon={Star}
        />
      );
    if (id === "viewers")
      return (
        <Metric
          label="Current viewers"
          value={stats.viewers?.toLocaleString("en-US") ?? "—"}
          loading={statsLoading}
          loadingWidth="w-11"
          icon={Eye}
        />
      );
    if (id === "duration")
      return (
        <Metric
          label="Stream duration"
          value={duration(stats.startedAt)}
          loading={statsLoading}
          loadingWidth="w-20"
          icon={Clock3}
        />
      );
    if (id === "bits")
      return (
        <Metric
          label="Bits collected"
          value={stats.bits.toLocaleString("en-US")}
          icon={Sparkles}
        />
      );
    if (id === "donations")
      return (
        <Metric
          label="Donations"
          value={money(stats.donations, stats.donationCurrency)}
          icon={Wallet}
        />
      );
    if (id === "status")
      return (
        <Metric
          label="Stream status"
          value={stats.live ? "Live" : "Offline"}
          note={statsLoading ? "" : stats.title}
          loading={statsLoading}
          loadingWidth="w-16"
          icon={Radio}
        />
      );
    return (
      <Metric
        label="Activity events"
        value={events.length.toLocaleString("en-US")}
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
    if (
      ![
        "activity",
        "streamDetails",
        "livePreview",
        "goals",
        "connections",
      ].includes(id)
    )
      return metric(id as DashboardWidgetId);
    if (id === "activity")
      return (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-xs font-semibold">Recent activity</h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("activity")}
            >
              View all
            </button>
          </div>
          <ActivityFeed
            events={events}
            limit={settings.uiDensity === "compact" ? 5 : 7}
            compact={settings.compactFeed || settings.uiDensity === "compact"}
          />
        </Card>
      );
    if (id === "streamDetails")
      return (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold">Stream details</h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("stream")}
            >
              Edit
            </button>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[10px] text-muted">Title</div>
              <div className="mt-1 text-xs">
                {statsLoading ? (
                  <LoadingIndicator className="h-3.5 w-4/5" />
                ) : (
                  stats.title || "No stream information"
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted">Category</div>
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
              Live Preview
            </div>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("livePreview")}
            >
              Open
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
          label: "Followers",
          value: stats.followers,
          target: settings.goals.followers,
        },
        {
          label: "Subscribers",
          value: stats.subscribers,
          target: settings.goals.subscribers,
        },
        {
          label: "Donations",
          value: stats.donations,
          target: settings.goals.donations,
        },
      ];
      return (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Target size={14} className="text-accent" />
              Goals
            </div>
            <button
              className="text-[11px] text-accent"
              onClick={() => setPage("goals")}
            >
              Manage
            </button>
          </div>
          <div className="space-y-3">
            {goals.map((goal) => {
              const percent =
                goal.value != null && goal.target
                  ? Math.min(100, (goal.value / goal.target) * 100)
                  : 0;
              return (
                <div key={goal.label}>
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-muted">{goal.label}</span>
                    {statsLoading && goal.label !== "Donations" ? (
                      <LoadingIndicator className="h-2.5 w-10" />
                    ) : (
                      <span>
                        {goal.target ? `${Math.round(percent)}%` : "No target"}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    {statsLoading && goal.label !== "Donations" ? (
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
          </div>
        </Card>
      );
    }
    return (
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Link2 size={14} className="text-accent" />
            Connections
          </div>
          <button
            className="text-[11px] text-accent"
            onClick={() => setPage("connections")}
          >
            Manage
          </button>
        </div>
        {[
          ["Twitch", twitch],
          ["StreamElements", streamElements],
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
                    service.account || service.phase
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
  const visibleMetricWidgets = widgets.filter((id) => metricWidgetIds.has(id));
  const visibleContentWidgets = widgets.filter(
    (id) => !metricWidgetIds.has(id),
  );
  return (
    <div
      ref={dashboardRef}
      style={{ zoom: zoom / 100, width: `${10_000 / zoom}%` }}
    >
      <PageHeader
        title="Dashboard"
        titleActions={
          <button
            onClick={() => setEditing(!editing)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition ${editing ? "bg-accent-soft text-accent" : "text-zinc-600 hover:bg-white/4 hover:text-zinc-300"}`}
          >
            {editing ? <LayoutGrid size={12} /> : <Settings2 size={12} />}{" "}
            {editing ? "Finish" : "Customize"}
          </button>
        }
        actions={
          statsLoading ? (
            <LoadingIndicator className="h-6 w-16" />
          ) : (
            <Badge
              tone={stats.live ? "green" : connected ? "neutral" : "amber"}
            >
              {stats.live ? "Live" : connected ? "Offline" : "Disconnected"}
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
        <HiddenWidgets
          widgets={hiddenWidgets}
          onShow={showWidget}
          onAddBrowser={() => setAddingBrowserSource(true)}
          onDeleteBrowser={deleteBrowserSource}
          onReset={resetDashboard}
        />
      )}
      {visibleMetricWidgets.length > 0 && (
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          }}
        >
          {visibleMetricWidgets.map((id) => {
            const label =
              availableWidgets.find((widget) => widget.id === id)?.label ??
              "Widget";
            return (
              <DashboardWidget
                key={id}
                editing={editing}
                label={label}
                onHide={() => hideWidget(id)}
              >
                {renderWidget(id)}
              </DashboardWidget>
            );
          })}
        </div>
      )}
      {visibleContentWidgets.length > 0 && (
        <div
          className={cn(
            "grid grid-flow-row-dense gap-2",
            visibleMetricWidgets.length > 0 && "mt-2",
          )}
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          }}
        >
          {visibleContentWidgets.map((id) => {
            const label =
              availableWidgets.find((widget) => widget.id === id)?.label ??
              "Widget";
            return (
              <div key={id} className={widgetLayoutClass(id)}>
                <DashboardWidget
                  editing={editing}
                  label={label}
                  onHide={() => hideWidget(id)}
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
      )}
      {widgets.length === 0 && (
        <Card className="grid min-h-52 place-items-center text-center">
          <div>
            <LayoutGrid size={24} className="mx-auto text-zinc-600" />
            <div className="mt-3 text-sm font-medium">
              Your dashboard is empty
            </div>
            {!editing && (
              <button
                className="mt-2 text-xs text-accent"
                onClick={() => setEditing(true)}
              >
                Add widgets
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
