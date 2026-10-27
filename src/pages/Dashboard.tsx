import {
  Activity,
  Clock3,
  Eye,
  EyeOff,
  Globe2,
  GripVertical,
  Heart,
  LayoutGrid,
  Link2,
  MonitorPlay,
  MoveDiagonal2,
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
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
  DashboardWidgetDimensions,
  DashboardWidgetId,
  DashboardWidgetWidth,
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
  id,
  editing,
  label,
  onHide,
  onDelete,
  onMoveStart,
  onResizeStart,
  children,
}: {
  id: DashboardItemId;
  editing: boolean;
  label: string;
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
        "relative h-full min-w-0",
        editing && "ring-1 ring-accent/25",
      )}
    >
      {editing && (
        <div className="absolute -top-2 right-2 z-20 flex items-center rounded-md border border-line bg-raised shadow-lg">
          <button
            type="button"
            title={t("dashboard.moveWidget", { label })}
            aria-label={t("dashboard.moveWidget", { label })}
            onPointerDown={onMoveStart}
            className="grid size-6 touch-none cursor-grab place-items-center text-zinc-500 outline-none hover:bg-white/5 hover:text-zinc-200 active:cursor-grabbing"
          >
            <GripVertical size={12} />
          </button>
          <button
            type="button"
            title={t("dashboard.hideWidget", { label })}
            aria-label={t("dashboard.hideWidget", { label })}
            onClick={onHide}
            className="grid size-6 place-items-center border-l border-line text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
          >
            <EyeOff size={12} />
          </button>
          {onDelete && (
            <button
              type="button"
              title={t("dashboard.deleteWidget", { label })}
              aria-label={t("dashboard.deleteWidget", { label })}
              onClick={onDelete}
              className="grid size-6 place-items-center border-l border-line text-zinc-500 hover:bg-red-400/10 hover:text-red-300"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
      <div className="h-full overflow-hidden [&>.card]:h-full">{children}</div>
      {editing && (
        <button
          type="button"
          title={t("dashboard.resizeWidget", { label })}
          aria-label={t("dashboard.resizeWidget", { label })}
          onPointerDown={onResizeStart}
          className="absolute bottom-0 right-0 z-20 grid size-7 touch-none cursor-se-resize place-items-center rounded-tl-md border-l border-t border-line bg-raised/95 text-accent outline-none hover:bg-raised"
        >
          <MoveDiagonal2 size={12} />
        </button>
      )}
    </div>
  );
}

function defaultWidgetDimensions(
  id: DashboardItemId,
): DashboardWidgetDimensions {
  if (metricWidgetIds.has(id)) return { width: "single", height: 96 };
  if (id === "activity") return { width: "wide", height: 288 };
  if (id === "streamDetails") return { width: "single", height: 224 };
  if (id === "livePreview") return { width: "full", height: 384 };
  if (id === "goals" || id === "connections")
    return { width: "single", height: 208 };
  return { width: "single", height: 320 };
}

function widgetLayoutClass(width: DashboardWidgetWidth) {
  if (width === "full") return "col-span-full";
  if (width === "wide") return "lg:col-span-2";
  return "";
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
  const { t } = useTranslation();
  return (
    <div
      className="card mb-2 flex min-h-10 items-center gap-2 border-dashed px-2.5 py-1.5 transition"
    >
      <div className="flex shrink-0 items-center gap-2 text-[11px] font-medium text-zinc-500">
        <EyeOff size={13} />
        {t("dashboard.hidden")}{" "}
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
                title={t("dashboard.showWidget", { label: widget.label, description: widget.description })}
                onClick={() => onShow(widget.id)}
                className="inline-flex items-center gap-1.5 px-2 text-[10px] text-zinc-500 transition hover:text-zinc-200"
              >
                <Eye size={11} />
                {widget.label}
              </button>
              {isBrowserWidget(widget.id) && (
                <button
                  type="button"
                  title={t("dashboard.deleteWidget", { label: widget.label })}
                  aria-label={t("dashboard.deleteWidget", { label: widget.label })}
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
            {t("dashboard.hiddenHint")}
          </span>
        )}
      </div>
      <button
        type="button"
        title={t("dashboard.addBrowserSource")}
        onClick={onAddBrowser}
        className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-black/15 px-2 text-[10px] text-zinc-400 transition hover:border-accent/50 hover:text-accent"
      >
        <Plus size={11} />
        {t("dashboard.browserSource")}
      </button>
      <button
        title={t("dashboard.resetDashboard")}
        aria-label={t("dashboard.resetDashboard")}
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
        <div className="grid gap-3 sm:grid-cols-[minmax(140px,0.35fr)_minmax(260px,1fr)_auto]">
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
  const [draggedWidget, setDraggedWidget] = useState<DashboardItemId | null>(
    null,
  );
  const [dragOrder, setDragOrder] = useState<DashboardItemId[] | null>(null);
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
          toast.error(t("dashboard.zoomSaveError")),
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
  }, [t]);
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
      if (sourceElement && sourceRect) animateElement(sourceElement, sourceRect);
      if (targetElement && targetRect) animateElement(targetElement, targetRect);
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
    if (!widget || !item || !grid) return;

    const startRect = item.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const gridStyle = getComputedStyle(grid);
    const tracks = gridStyle.gridTemplateColumns
      .split(" ")
      .map((track) => Number.parseFloat(track))
      .filter(Number.isFinite);
    const columnCount = Math.max(1, tracks.length);
    const scale =
      Math.max(50, Math.min(150, settings.dashboardZoom || 100)) / 100;
    const columnGap = (Number.parseFloat(gridStyle.columnGap) || 0) * scale;
    const cellWidth = tracks.length ? tracks[0] * scale : gridRect.width;
    const startX = event.clientX;
    const startY = event.clientY;
    let nextWidth = dimensionsFor(id).width;
    let nextHeight = dimensionsFor(id).height;
    const heightSnapCandidates = Array.from(
      grid.querySelectorAll<HTMLElement>("[data-dashboard-drop-id]"),
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
        Math.min(160, gridRect.width),
        Math.min(
          gridRect.right - startRect.left,
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
            <h2 className="text-xs font-semibold">{t("dashboard.recentActivity")}</h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("activity")}
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
    if (id === "streamDetails")
      return (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold">{t("dashboard.streamDetails")}</h2>
            <button
              className="text-[11px] text-accent hover:brightness-125"
              onClick={() => setPage("stream")}
            >
              {t("dashboard.edit")}
            </button>
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[10px] text-muted">{t("dashboard.streamTitle")}</div>
              <div className="mt-1 text-xs">
                {statsLoading ? (
                  <LoadingIndicator className="h-3.5 w-4/5" />
                ) : (
                  stats.title || t("dashboard.noStreamInfo")
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-muted">{t("stream.category")}</div>
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
      const raidCount = events.filter((event) => event.eventType === "raid").length;
      const giftSubscriptionCount = events.reduce(
        (total, event) =>
          total +
          (event.eventType === "community_gift"
            ? (event.giftCount ?? 1)
            : event.eventType === "gift_subscription"
              ? 1
              : 0),
        0,
      );
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
          value: raidCount,
          target: settings.goals.raids,
          loading: false,
        },
        {
          label: t("goals.giftSubscriptions"),
          value: giftSubscriptionCount,
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
                        {goal.target ? `${Math.round(percent)}%` : t("goals.noTarget")}
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
              {stats.live ? t("stream.live") : connected ? t("stream.offline") : t("connectionPhases.disconnected")}
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
              t("dashboard.widget");
            const dimensions = dimensionsFor(id);
            return (
              <div
                key={id}
                data-dashboard-drop-id={id}
                className={cn(
                  "rounded-xl transition",
                  widgetLayoutClass(dimensions.width),
                  draggedWidget === id && "ring-2 ring-accent/60",
                )}
                style={{ height: dimensions.height }}
              >
                <DashboardWidget
                  id={id}
                  editing={editing}
                  label={label}
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
              t("dashboard.widget");
            const dimensions = dimensionsFor(id);
            return (
              <div
                key={id}
                data-dashboard-drop-id={id}
                className={cn(
                  "rounded-xl transition",
                  widgetLayoutClass(dimensions.width),
                  draggedWidget === id && "ring-2 ring-accent/60",
                )}
                style={{ height: dimensions.height }}
              >
                <DashboardWidget
                  id={id}
                  editing={editing}
                  label={label}
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
