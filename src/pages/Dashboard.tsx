import {
  Activity,
  Clock3,
  Eye,
  EyeOff,
  GripVertical,
  Heart,
  LayoutGrid,
  Link2,
  MonitorPlay,
  Radio,
  RotateCcw,
  Settings2,
  Sparkles,
  Star,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { useAppStore, defaultDashboardWidgets } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { ActivityFeed } from "../components/ActivityFeed";
import { TwitchPlayer } from "../components/TwitchPlayer";
import {
  Badge,
  Card,
  LoadingIndicator,
  PageHeader,
} from "../components/ui";
import { cn, money } from "../lib/utils";
import type { ConnectionState, DashboardWidgetId } from "../types";

const widgetCatalog: Array<{
  id: DashboardWidgetId;
  label: string;
  description: string;
}> = [
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
const allWidgetIds = new Set(widgetCatalog.map((widget) => widget.id));

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
    <Card className="flex min-h-24 flex-col p-3.5">
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
function widgetSpan(id: DashboardWidgetId) {
  if (id === "activity") return "col-span-12 lg:col-span-8";
  if (id === "livePreview") return "col-span-12 lg:col-span-8";
  if (id === "streamDetails") return "col-span-12 lg:col-span-4";
  if (id === "goals" || id === "connections")
    return "col-span-12 lg:col-span-6";
  return "col-span-12 sm:col-span-6 xl:col-span-3";
}
const hiddenDropId = "dashboard-hidden-widgets";

function SortableWidget({
  id,
  editing,
  label,
  onHide,
  children,
}: {
  id: DashboardWidgetId;
  editing: boolean;
  label: string;
  onHide: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative min-w-0 [&>.card]:h-full",
        widgetSpan(id),
        editing && "rounded-xl ring-1 ring-accent/20",
        isDragging && "z-10 opacity-20",
      )}
    >
      {editing && (
        <div className="absolute -top-2 right-2 z-20 flex items-center rounded-md border border-line bg-raised shadow-lg">
          <button
            type="button"
            title={`Move ${label}`}
            aria-label={`Drag ${label} to reorder`}
            {...attributes}
            {...listeners}
            className="grid size-6 cursor-grab place-items-center text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 active:cursor-grabbing"
          >
            <GripVertical size={12} />
          </button>
          <button
            type="button"
            title={`Hide ${label}`}
            aria-label={`Hide ${label}`}
            onClick={onHide}
            className="grid size-6 place-items-center border-l border-line text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <EyeOff size={12} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}

function HiddenWidgets({
  widgets,
  onShow,
  onReset,
}: {
  widgets: typeof widgetCatalog;
  onShow: (id: DashboardWidgetId) => void;
  onReset: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: hiddenDropId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "card mb-3 flex min-h-12 items-center gap-3 border-dashed px-3 py-2 transition",
        isOver && "border-accent bg-accent-soft",
      )}
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
            <button
              key={widget.id}
              title={`Show ${widget.label} · ${widget.description}`}
              onClick={() => onShow(widget.id)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-black/15 px-2 text-[10px] text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              <Eye size={11} />
              {widget.label}
            </button>
          ))
        ) : (
          <span
            className={cn(
              "text-[10px]",
              isOver ? "text-accent" : "text-zinc-700",
            )}
          >
            {isOver ? "Release to hide" : "Drag a card here to hide it"}
          </span>
        )}
      </div>
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
  const [dragging, setDragging] = useState<DashboardWidgetId>();
  const [dragSize, setDragSize] = useState<{ width: number; height: number }>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const connected =
    twitch.phase === "connected" || streamElements.phase === "connected";
  const widgets = useMemo(
    () =>
      Array.isArray(settings.dashboardWidgets)
        ? [
            ...new Set(
              settings.dashboardWidgets.filter((id) => allWidgetIds.has(id)),
            ),
          ]
        : defaultDashboardWidgets,
    [settings.dashboardWidgets],
  );
  const hiddenWidgets = useMemo(
    () => widgetCatalog.filter((widget) => !widgets.includes(widget.id)),
    [widgets],
  );
  const updateWidgets = (next: DashboardWidgetId[]) => {
    setSettings({ dashboardWidgets: next });
    void saveSetting("dashboardWidgets", next).catch(() =>
      toast.error("Dashboard layout could not be saved"),
    );
  };
  const hideWidget = (id: DashboardWidgetId) =>
    updateWidgets(widgets.filter((widget) => widget !== id));
  const showWidget = (id: DashboardWidgetId) => updateWidgets([...widgets, id]);
  const finishDrag = () => {
    setDragging(undefined);
    setDragSize(undefined);
  };
  const startDrag = (event: DragStartEvent) => {
    const id = event.active.id as DashboardWidgetId;
    if (!allWidgetIds.has(id)) return;
    const rect = event.active.rect.current.initial;
    setDragging(id);
    if (rect) setDragSize({ width: rect.width, height: rect.height });
  };
  const endDrag = (event: DragEndEvent) => {
    const source = event.active.id as DashboardWidgetId;
    const target = event.over?.id;
    if (allWidgetIds.has(source) && target === hiddenDropId) hideWidget(source);
    else if (
      allWidgetIds.has(source) &&
      target &&
      allWidgetIds.has(target as DashboardWidgetId) &&
      source !== target
    ) {
      const from = widgets.indexOf(source);
      const to = widgets.indexOf(target as DashboardWidgetId);
      if (from >= 0 && to >= 0) updateWidgets(arrayMove(widgets, from, to));
    }
    finishDrag();
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
  const renderWidget = (id: DashboardWidgetId) => {
    if (
      ![
        "activity",
        "streamDetails",
        "livePreview",
        "goals",
        "connections",
      ].includes(id)
    )
      return metric(id);
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
        <Card className="overflow-hidden">
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
          <div className="overflow-hidden bg-black">
            <TwitchPlayer className="aspect-video h-auto w-full" />
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
  const activeWidget =
    dragging && allWidgetIds.has(dragging) ? dragging : undefined;
  return (
    <>
      <PageHeader
        title="Dashboard"
        titleActions={
          <button
            onClick={() => {
              setEditing(!editing);
              finishDrag();
            }}
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={startDrag}
        onDragEnd={endDrag}
        onDragCancel={finishDrag}
      >
        {editing && (
          <HiddenWidgets
            widgets={hiddenWidgets}
            onShow={showWidget}
            onReset={() => updateWidgets(defaultDashboardWidgets)}
          />
        )}
        <SortableContext items={widgets} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-3">
            {widgets.map((id) => {
              const label =
                widgetCatalog.find((widget) => widget.id === id)?.label ??
                "Widget";
              return (
                <SortableWidget
                  key={id}
                  id={id}
                  editing={editing}
                  label={label}
                  onHide={() => hideWidget(id)}
                >
                  {renderWidget(id)}
                </SortableWidget>
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay
          dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}
        >
          {activeWidget && (
            <div
              style={{ width: dragSize?.width, height: dragSize?.height }}
              className="pointer-events-none [&>.card]:h-full opacity-95 drop-shadow-2xl"
            >
              {renderWidget(activeWidget)}
            </div>
          )}
        </DragOverlay>
      </DndContext>
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
    </>
  );
}
