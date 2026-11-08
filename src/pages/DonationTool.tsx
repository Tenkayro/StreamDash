import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es, fr, ptBR } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Ban,
  Check,
  CircleDollarSign,
  Copy,
  Gift,
  HandCoins,
  Inbox,
  Play,
  RadioTower,
  Search,
  Sparkles,
  Star,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useSearchFilter } from "../lib/search-navigation";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  ScrollFade,
} from "../components/ui";
import { money } from "../lib/utils";
import { saveSetting } from "../services/native";
import { useAppStore } from "../stores/app-store";
import type { ActivityEvent, ActivitySource, ActivityType } from "../types";

type Tab =
  | "all"
  | "tips"
  | "subscriber"
  | "subgifts"
  | "raids"
  | "cheers"
  | "done";

const tabs: Tab[] = [
  "all",
  "tips",
  "subscriber",
  "subgifts",
  "raids",
  "cheers",
  "done",
];

function eventTypeToTab(event: ActivityEvent): Tab | undefined {
  switch (event.eventType) {
    case "donation":
      return "tips";
    case "subscription":
    case "resubscription":
      return "subscriber";
    case "gift_subscription":
    case "community_gift":
      return "subgifts";
    case "raid":
      return "raids";
    case "cheer":
      return "cheers";
    default:
      return undefined;
  }
}

const sourceStyles: Record<ActivitySource, string> = {
  twitch: "bg-violet-400/10 text-violet-300",
  streamelements: "bg-emerald-400/10 text-emerald-300",
  tipeeestream: "bg-sky-400/10 text-sky-300",
};

const eventIcons: Partial<Record<ActivityType, LucideIcon>> = {
  donation: HandCoins,
  subscription: Star,
  resubscription: Star,
  gift_subscription: Gift,
  community_gift: Gift,
  cheer: Sparkles,
  raid: RadioTower,
  follow: UserPlus,
  channel_point: CircleDollarSign,
};

const actionClass =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40";

const noUsers: string[] = [];

function isBlocked(
  event: ActivityEvent,
  blockedUsers: string[] | undefined,
  language: string,
) {
  if (!event.username || !blockedUsers?.length) return false;
  const user = event.username.toLocaleLowerCase(language);
  return blockedUsers.some(
    (name) => name.toLocaleLowerCase(language) === user,
  );
}

export function DonationTool() {
  const { t, i18n } = useTranslation();
  const {
    events,
    settings,
    setSettings,
    setPage,
    streamElements,
    tipeeStream,
  } = useAppStore();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [minSubgifts, setMinSubgifts] = useState(0);
  useSearchFilter("donationTool", (value) => {
    setSearch(value);
    setTab("all");
  });
  const dateLocale =
    { de, en: enUS, es, fr, "pt-BR": ptBR }[i18n.language] ?? enUS;
  const doneIds = useMemo(
    () => new Set(settings.donationToolDoneIds ?? []),
    [settings.donationToolDoneIds],
  );
  const blockedUsers = settings.chatHiddenUsers ?? noUsers;
  const connected =
    streamElements.phase === "connected" || tipeeStream.phase === "connected";

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.language);
    return events
      .filter((event) => {
        if (isBlocked(event, blockedUsers, i18n.language)) return false;
        if (tab === "done") return doneIds.has(event.id);
        if (tab !== "all" && eventTypeToTab(event) !== tab) return false;
        if (
          tab === "subgifts" &&
          minSubgifts > 0 &&
          (event.giftCount ?? 0) < minSubgifts
        )
          return false;
        if (!needle) return true;
        return `${event.displayName ?? ""} ${event.username ?? ""} ${event.message ?? ""}`
          .toLocaleLowerCase(i18n.language)
          .includes(needle);
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [
    events,
    i18n.language,
    search,
    tab,
    minSubgifts,
    doneIds,
    blockedUsers,
  ]);

  const counts = useMemo(() => {
    const map = new Map<Tab, number>();
    for (const tabKey of tabs) map.set(tabKey, 0);
    for (const event of events) {
      if (isBlocked(event, blockedUsers, i18n.language)) continue;
      map.set("all", (map.get("all") ?? 0) + 1);
      const eventTab = eventTypeToTab(event);
      if (eventTab) map.set(eventTab, (map.get(eventTab) ?? 0) + 1);
      if (doneIds.has(event.id)) map.set("done", (map.get("done") ?? 0) + 1);
    }
    return map;
  }, [events, doneIds, blockedUsers, i18n.language]);

  const who = (event: ActivityEvent) =>
    event.displayName || event.username || t("activity.anonymous");
  const doneEmpty = tab === "done" && !search.trim() && !filtered.length;

  const replay = (event: ActivityEvent) => {
    window.dispatchEvent(
      new CustomEvent("streamdash:donation-replay", { detail: event }),
    );
    toast.success(t("donationTool.replayed"), {
      description: [
        who(event),
        event.amount != null
          ? money(event.amount, event.currency)
          : t(`events.${event.eventType}`),
      ].join(" · "),
    });
  };

  const toggleDone = (event: ActivityEvent) => {
    const previous = settings.donationToolDoneIds ?? [];
    const wasDone = previous.includes(event.id);
    const next = wasDone
      ? previous.filter((id) => id !== event.id)
      : [event.id, ...previous];
    setSettings({ donationToolDoneIds: next });
    toast.success(
      t(wasDone ? "donationTool.reopened" : "donationTool.markedDone"),
    );
    void saveSetting("donationToolDoneIds", next).catch(() => {
      setSettings({ donationToolDoneIds: previous });
      toast.error(t("donationTool.saveFailed"));
    });
  };

  const blockUser = (event: ActivityEvent) => {
    const name = event.username?.trim();
    if (!name) return;
    const key = name.toLocaleLowerCase(i18n.language);
    if (
      blockedUsers.some(
        (user) => user.toLocaleLowerCase(i18n.language) === key,
      )
    )
      return;
    const previous = blockedUsers;
    const next = [...previous, key];
    setSettings({ chatHiddenUsers: next });
    toast.success(t("donationTool.blocked", { name }), {
      action: {
        label: t("donationTool.undo"),
        onClick: () => {
          const reverted = (
            useAppStore.getState().settings.chatHiddenUsers ?? []
          ).filter((user) => user !== key);
          setSettings({ chatHiddenUsers: reverted });
          void saveSetting("chatHiddenUsers", reverted).catch(() =>
            toast.error(t("donationTool.saveFailed")),
          );
        },
      },
    });
    void saveSetting("chatHiddenUsers", next).catch(() => {
      setSettings({ chatHiddenUsers: previous });
      toast.error(t("donationTool.saveFailed"));
    });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("donationTool.copied"));
    } catch {
      toast.error(t("donationTool.copyFailed"));
    }
  };

  return (
    <>
      <PageHeader
        icon={HandCoins}
        title={t("donationTool.title")}
        description={t("donationTool.description", {
          count: filtered.length,
        })}
        actions={
          connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
              {t("donationTool.live")}
            </span>
          ) : undefined
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white/[.012] p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />
            <input
              className="input input-leading-icon input-trailing-action"
              aria-label={t("donationTool.searchLabel")}
              placeholder={t("donationTool.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                title={t("donationTool.clearSearch")}
                aria-label={t("donationTool.clearSearch")}
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="relative">
            <Gift
              size={14}
              className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${minSubgifts > 0 ? "text-accent" : "text-zinc-600"}`}
            />
            <input
              type="number"
              min={0}
              className="input input-leading-icon w-32"
              aria-label={t("donationTool.minSubgifts")}
              placeholder={t("donationTool.minSubgifts")}
              value={minSubgifts || ""}
              onChange={(event) =>
                setMinSubgifts(Number(event.target.value) || 0)
              }
            />
          </div>
        </div>

        <div
          role="tablist"
          aria-label={t("donationTool.title")}
          className="flex flex-wrap gap-1 border-b border-line bg-white/[.008] px-3 py-2"
        >
          {tabs.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              role="tab"
              aria-selected={tab === tabKey}
              onClick={() => setTab(tabKey)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                tab === tabKey
                  ? "bg-accent/20 text-accent"
                  : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {t(`donationTool.tabs.${tabKey}`)}
              <span className="ml-1.5 text-[10px] text-zinc-600">
                {counts.get(tabKey) ?? 0}
              </span>
            </button>
          ))}
        </div>

        {!filtered.length ? (
          <EmptyState
            icon={<Inbox size={25} />}
            title={t(
              events.length
                ? doneEmpty
                  ? "donationTool.doneEmpty"
                  : "donationTool.noMatches"
                : "donationTool.empty",
            )}
            body={t(
              events.length
                ? doneEmpty
                  ? "donationTool.doneEmptyDetail"
                  : "donationTool.tryFilters"
                : connected
                  ? "donationTool.waiting"
                  : "donationTool.emptyDetail",
            )}
            action={
              !events.length && !connected ? (
                <Button
                  variant="primary"
                  onClick={() => setPage("connections")}
                >
                  {t("donationTool.connectServices")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ScrollFade color="#242526" size={32}>
            <div className="max-h-[calc(100vh-286px)] min-h-52 overflow-y-auto p-2">
              {filtered.map((event) => {
                const name = who(event);
                const isDone = doneIds.has(event.id);
                const Icon = eventIcons[event.eventType] ?? Activity;
                const metric =
                  event.giftCount != null
                    ? `×${event.giftCount}`
                    : event.bits != null
                      ? `${event.bits} ${t("donationTool.bits")}`
                      : event.viewerCount != null
                        ? `${event.viewerCount} ${t("donationTool.viewers")}`
                        : null;
                return (
                  <article
                    key={event.id}
                    className={`event-enter mb-1.5 rounded-lg border px-3.5 py-2.5 transition-colors last:mb-0 ${
                      isDone
                        ? "border-emerald-400/25 bg-emerald-400/5"
                        : "border-transparent bg-white/[.018] hover:border-line hover:bg-white/3"
                    }`}
                  >
                    <div className="flex min-h-12 items-center gap-3">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-lg ${sourceStyles[event.source]}`}
                      >
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="max-w-full truncate text-sm font-semibold text-zinc-200">
                            {name}
                          </span>
                          <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                            {t(`events.${event.eventType}`)}
                          </span>
                          {event.amount != null && (
                            <span className="shrink-0 rounded-full bg-emerald-300 px-2 py-0.5 text-xs font-bold text-emerald-950">
                              {money(event.amount, event.currency)}
                            </span>
                          )}
                          {metric && (
                            <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                              {metric}
                            </span>
                          )}
                          {isDone && (
                            <Check
                              size={13}
                              className="shrink-0 text-emerald-400"
                            />
                          )}
                        </div>
                        {event.message && (
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {event.message}
                          </p>
                        )}
                      </div>
                      <span
                        className="shrink-0 text-[11px] text-zinc-600"
                        title={new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(event.timestamp))}
                      >
                        {formatDistanceToNow(new Date(event.timestamp), {
                          addSuffix: true,
                          locale: dateLocale,
                        })}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/6 pt-2">
                      <button
                        type="button"
                        onClick={() => replay(event)}
                        className={actionClass}
                      >
                        <Play size={12} />
                        {t("donationTool.replay")}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleDone(event)}
                        className={`${actionClass} ${
                          isDone
                            ? "text-emerald-300 hover:text-emerald-200"
                            : "hover:text-emerald-300"
                        }`}
                      >
                        <Check size={12} />
                        {t(
                          isDone
                            ? "donationTool.reopen"
                            : "donationTool.markDone",
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => blockUser(event)}
                        disabled={!event.username}
                        title={
                          event.username
                            ? t("donationTool.block")
                            : t("donationTool.blockUnavailable")
                        }
                        className={`${actionClass} hover:text-red-300`}
                      >
                        <Ban size={12} />
                        {t("donationTool.block")}
                      </button>
                      {event.message && (
                        <button
                          type="button"
                          onClick={() => void copyText(event.message ?? "")}
                          className={actionClass}
                        >
                          <Copy size={12} />
                          {t("donationTool.copyText")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyText(event.id)}
                        className={actionClass}
                      >
                        <Copy size={12} />
                        {t("donationTool.copyId")}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </ScrollFade>
        )}

        <div className="border-t border-line bg-white/[.012] px-4 py-2 text-[11px] text-zinc-600">
          {t("donationTool.eventsFound", { count: filtered.length })}
        </div>
      </Card>
    </>
  );
}
