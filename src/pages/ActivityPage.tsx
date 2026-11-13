import { useSearchFilter } from "../lib/search-navigation";
import { Select } from "../components/Select";
import {
  Activity, Ban, Check, ChevronDown, ChevronRight, CircleDollarSign, Copy, Gift, HandCoins, Heart, Inbox, ListFilter, Play, Radio, RadioTower, Search, SlidersHorizontal, Sparkles, Star, Trash2, Tv, X, type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es, fr, ptBR } from "date-fns/locale";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ActivityFeed } from "../components/ActivityFeed";
import { UserCard } from "../components/chat/UserCard";
import { Button, Card, EmptyState, PageHeader, ScrollFade } from "../components/ui";
import { money } from "../lib/utils";
import { clearEvents as clearNativeEvents, saveSetting } from "../services/native";
import { useAppStore } from "../stores/app-store";
import type { ActivityEvent, ActivitySource, ActivityType } from "../types";

type FocusTab = "all" | "tips" | "subscriber" | "subgifts" | "raids" | "cheers" | "follow" | "channel_point" | "stream" | "other" | "done" | "activity";
type SortMode = "newest" | "largest";

const focusTabs: FocusTab[] = ["all", "tips", "subscriber", "subgifts", "raids", "cheers", "follow", "channel_point", "stream", "other", "done", "activity"];
const noUsers: string[] = [];
const sourceNames: Record<ActivitySource, string> = { twitch: "Twitch", streamelements: "StreamElements", tipeeestream: "TipeeeStream" };
const sourceStyles: Record<ActivitySource, string> = { twitch: "bg-violet-400/10 text-violet-300", streamelements: "bg-emerald-400/10 text-emerald-300", tipeeestream: "bg-sky-400/10 text-sky-300" };
const eventIcons: Partial<Record<ActivityType, LucideIcon>> = { donation: HandCoins, subscription: Star, resubscription: Star, gift_subscription: Gift, community_gift: Gift, cheer: Sparkles, raid: RadioTower, follow: Heart, channel_point: Sparkles, stream_online: Tv, stream_offline: Radio };
const actionClass = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40";

function eventTab(event: ActivityEvent): FocusTab {
  switch (event.eventType) {
    case "donation": return "tips";
    case "subscription": case "resubscription": return "subscriber";
    case "gift_subscription": case "community_gift": return "subgifts";
    case "raid": return "raids";
    case "cheer": return "cheers";
    case "follow": return "follow";
    case "channel_point": return "channel_point";
    case "stream_online": case "stream_offline": return "stream";
    default: return "other";
  }
}
function isBlocked(event: ActivityEvent, blockedUsers: string[] | undefined, language: string) {
  if (!event.username || !blockedUsers?.length) return false;
  const user = event.username.toLocaleLowerCase(language);
  return blockedUsers.some((name) => name.toLocaleLowerCase(language) === user);
}

export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const { events, chatMessages, settings, setSettings, setPage, twitch, streamElements, tipeeStream, clearEvents } = useAppStore();
  const [search, setSearch] = useState("");
  const [searchHit, setSearchHit] = useState<string>();
  const [tab, setTab] = useState<FocusTab>("all");
  const [source, setSource] = useState<ActivitySource | "all">("all");
  const [type, setType] = useState<ActivityType | "all">("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [minSubgifts, setMinSubgifts] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>();

  useSearchFilter("activitys", (value, itemId) => { setSearch(value); setSearchHit(itemId); setTab("all"); setSource("all"); setType("all"); });

  const dateLocale = { de, en: enUS, es, fr, "pt-BR": ptBR }[i18n.language] ?? enUS;
  const doneIds = useMemo(() => new Set(settings.donationToolDoneIds ?? []), [settings.donationToolDoneIds]);
  const blockedUsers = settings.chatHiddenUsers ?? noUsers;
  const connected = streamElements.phase === "connected" || tipeeStream.phase === "connected";
  const donations = useMemo(() => events.filter((event) => event.eventType === "donation"), [events]);
  const totals = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const event of donations) { const currency = event.currency ?? ""; grouped.set(currency, (grouped.get(currency) ?? 0) + (event.amount ?? 0)); }
    return [...grouped.entries()];
  }, [donations]);
  const topDonationId = useMemo(() => donations.reduce((top, event) => (event.amount ?? 0) > (top?.amount ?? -1) ? event : top, donations[0])?.id, [donations]);
  const needle = search.trim().toLocaleLowerCase(i18n.language);
  const matchesText = useCallback((event: ActivityEvent) => !needle || `${event.displayName ?? ""} ${event.username ?? ""} ${event.message ?? ""}`.toLocaleLowerCase(i18n.language).includes(needle), [needle, i18n.language]);

  const feedEvents = useMemo(() => events.filter((e) => (type === "all" || e.eventType === type) && (source === "all" || e.source === source) && (searchHit ? e.id === searchHit : matchesText(e))), [events, searchHit, type, source, matchesText]);
  const inboxFiltered = useMemo(() => events.filter((event) => {
    if (isBlocked(event, blockedUsers, i18n.language)) return false;
    if (tab === "done") { if (!doneIds.has(event.id)) return false; }
    else if (tab !== "all" && tab !== "activity" && eventTab(event) !== tab) return false;
    if (source !== "all" && event.source !== source) return false;
    if (tab === "subgifts" && minSubgifts > 0 && (event.giftCount ?? 0) < minSubgifts) return false;
    if (searchHit) return event.id === searchHit;
    return matchesText(event);
  }).sort((a, b) => sort === "largest" ? (b.amount ?? 0) - (a.amount ?? 0) || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime() : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [events, doneIds, blockedUsers, i18n.language, searchHit, source, tab, minSubgifts, sort, matchesText]);

  const counts = useMemo(() => {
    const map = new Map<FocusTab, number>();
    for (const key of focusTabs) map.set(key, 0);
    map.set("activity", events.length);
    for (const event of events) {
      if (isBlocked(event, blockedUsers, i18n.language)) continue;
      map.set("all", (map.get("all") ?? 0) + 1);
      const key = eventTab(event); map.set(key, (map.get(key) ?? 0) + 1);
      if (doneIds.has(event.id)) map.set("done", (map.get("done") ?? 0) + 1);
    }
    return map;
  }, [events, doneIds, blockedUsers, i18n.language]);

  const selected = useMemo(() => { const id = searchHit ?? selectedId; if (!id) return undefined; return inboxFiltered.find((event) => event.id === id); }, [inboxFiltered, searchHit, selectedId]);
  const who = (event: ActivityEvent) => event.displayName || event.username || t("donations.anonymous");
  const remove = async () => { if (!confirm(t("activity.clearConfirm"))) return; await clearNativeEvents(); clearEvents(); };
  const replay = (event: ActivityEvent) => { window.dispatchEvent(new CustomEvent("streamdash:donation-replay", { detail: event })); toast.success(t("donations.replayed"), { description: [who(event), event.amount != null ? money(event.amount, event.currency) : t(`events.${event.eventType}`)].join(" · ") }); };
  const toggleDone = (event: ActivityEvent) => {
    const previous = settings.donationToolDoneIds ?? []; const wasDone = previous.includes(event.id);
    const next = wasDone ? previous.filter((id) => id !== event.id) : [event.id, ...previous];
    setSettings({ donationToolDoneIds: next }); toast.success(t(wasDone ? "donations.reopened" : "donations.markedDone"));
    void saveSetting("donationToolDoneIds", next).catch(() => { setSettings({ donationToolDoneIds: previous }); toast.error(t("donations.saveFailed")); });
  };
  const blockUser = (event: ActivityEvent) => {
    const name = event.username?.trim(); if (!name) return; const key = name.toLocaleLowerCase(i18n.language);
    if (blockedUsers.some((user) => user.toLocaleLowerCase(i18n.language) === key)) return;
    const previous = blockedUsers; const next = [...previous, key]; setSettings({ chatHiddenUsers: next });
    toast.success(t("donations.blocked", { name }), { action: { label: t("donations.undo"), onClick: () => { const reverted = (useAppStore.getState().settings.chatHiddenUsers ?? []).filter((user) => user !== key); setSettings({ chatHiddenUsers: reverted }); void saveSetting("chatHiddenUsers", reverted).catch(() => toast.error(t("donations.saveFailed"))); } } });
    void saveSetting("chatHiddenUsers", next).catch(() => { setSettings({ chatHiddenUsers: previous }); toast.error(t("donations.saveFailed")); });
  };
  const copyText = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t("donations.copied")); } catch { toast.error(t("donations.copyFailed")); } };

  return (<>
    <PageHeader icon={Activity} title={t("nav.activitys")} description={t("pageDescriptions.activitys")} actions={<>{connected && <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300"><span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />{t("donations.live")}</span>}<Button variant="danger" disabled={!events.length} onClick={remove}><Trash2 size={14} />{t("activity.clearHistory")}</Button></>} />
    <div className="mb-2.5 grid shrink-0 gap-2.5 sm:grid-cols-3">
      <Card className="flex min-h-15 flex-col justify-between px-4 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-muted">{t("donations.totalReceived")}</p><CircleDollarSign size={14} className="text-emerald-400" aria-hidden="true" /></div><p className="mt-1 truncate text-base font-semibold tabular-nums text-ink">{totals.length ? totals.map(([currency, value]) => money(value, currency || undefined)).join(" · ") : money(0)}</p></Card>
      <Card className="flex min-h-15 flex-col justify-between px-4 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-muted">{t("donations.received")}</p><Inbox size={14} className="text-accent" aria-hidden="true" /></div><p className="mt-1 text-base font-semibold tabular-nums text-ink">{t("donations.donationCount", { count: donations.length })}</p></Card>
      <Card className="flex min-h-15 flex-col justify-between px-4 py-3"><div className="flex items-center justify-between gap-2"><p className="text-[11px] font-medium text-muted">{t("donations.topDonation")}</p><Star size={14} className="text-amber-400" aria-hidden="true" /></div><p className="mt-1 truncate text-base font-semibold tabular-nums text-ink">{donations.length ? money(donations.find((event) => event.id === topDonationId)?.amount ?? 0, donations.find((event) => event.id === topDonationId)?.currency) : "—"}</p></Card>
    </div>
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-1 gap-2 border-b border-line bg-white/2 p-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(200px,1fr)_170px_160px_130px]">
        <div className="relative min-w-0"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><input className="input input-leading-icon input-trailing-action" aria-label={t("activity.searchLabel")} placeholder={t("activity.searchPlaceholder")} value={search} onChange={(e) => { setSearch(e.target.value); setSearchHit(undefined); }} />{search && <button type="button" title={t("activity.clearSearch")} aria-label={t("activity.clearSearch")} onClick={() => { setSearch(""); setSearchHit(undefined); }} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"><X size={13} /></button>}</div>
        <div className="relative min-w-0"><RadioTower size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><Select className="input input-leading-icon input-trailing-action appearance-none" aria-label={t("activity.filterSource")} value={source} onChange={(e) => { setSource(e.target.value as ActivitySource | "all"); setSearchHit(undefined); }}><option value="all">{t("activity.allSources")}</option><option value="twitch">Twitch</option><option value="streamelements">StreamElements</option><option value="tipeeestream">TipeeeStream</option></Select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" /></div>
        {tab === "activity" ? (<div className="relative min-w-0"><ListFilter size={14} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${type === "all" ? "text-zinc-600" : "text-accent"}`} /><Select className="input input-leading-icon input-trailing-action appearance-none" aria-label={t("activity.filterType")} value={type} onChange={(e) => setType(e.target.value as ActivityType | "all")}><option value="all">{t("activity.allTypes")}</option>{["follow","subscription","resubscription","gift_subscription","community_gift","cheer","raid","donation","channel_point","stream_online","stream_offline","other"].map((v) => <option value={v} key={v}>{t(`events.${v}`)}</option>)}</Select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" /></div>) : (<div className="relative min-w-0"><SlidersHorizontal size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" /><Select className="input input-leading-icon input-trailing-action appearance-none" aria-label={t("donations.sortLabel")} value={sort} onChange={(e) => setSort(e.target.value as SortMode)}><option value="newest">{t("donations.newest")}</option><option value="largest">{t("donations.largest")}</option></Select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" /></div>)}
        <div className="relative min-w-0"><Gift size={14} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${minSubgifts > 0 ? "text-accent" : "text-zinc-600"}`} /><input type="number" min={0} className="input input-leading-icon w-full" aria-label={t("donations.minSubgifts")} placeholder={t("donations.minSubgifts")} value={minSubgifts || ""} onChange={(e) => setMinSubgifts(Number(e.target.value) || 0)} /></div>
      </div>
      <div role="tablist" aria-label={t("nav.activitys")} className="flex shrink-0 flex-wrap gap-1 border-b border-line bg-white/1 px-3 py-1.5">
        {focusTabs.map((key) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setSearchHit(undefined); }} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${tab === key ? "bg-accent/20 text-accent" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}>{t(key === "activity" ? "nav.activity" : `donations.tabs.${key}`)}<span className="ml-1.5 text-[10px] text-zinc-600">{counts.get(key) ?? 0}</span></button>)}
      </div>
      {tab === "activity" ? (<ScrollFade className="flex min-h-0 flex-1 flex-col" color="#242526" size={32}><div className="min-h-0 flex-1 overflow-y-auto"><ActivityFeed events={feedEvents} compact={settings.compactFeed} onUser={twitch.phase === "connected" ? setSelectedUser : undefined} emptyTitle={events.length ? t("activity.noMatches") : t("activity.empty")} emptyBody={events.length ? t("activity.tryFilters") : undefined} /></div></ScrollFade>) : !inboxFiltered.length ? (<div className="grid min-h-0 flex-1 place-items-center"><EmptyState icon={<CircleDollarSign size={25} />} title={t(!events.length ? "donations.empty" : tab === "done" && !counts.get("done") ? "donations.doneEmpty" : "donations.noMatches")} body={t(!events.length ? (connected ? "donations.waiting" : "donations.emptyDetail") : tab === "done" && !counts.get("done") ? "donations.doneEmptyDetail" : "donations.tryFilters")} action={!events.length && !connected ? <Button variant="primary" onClick={() => setPage("connections")}>{t("donations.connectServices")}</Button> : undefined} /></div>) : (<ScrollFade className="flex min-h-0 flex-1 flex-col" color="#242526" size={32}><div className="min-h-0 flex-1 overflow-y-auto p-2">
        {inboxFiltered.map((event) => {
          const isSelected = event.id === selected?.id; const isDone = doneIds.has(event.id); const isTop = event.eventType === "donation" && event.id === topDonationId; const Icon = eventIcons[event.eventType] ?? Activity; const name = who(event);
          const metric = event.amount != null ? money(event.amount, event.currency) : event.giftCount != null ? `×${event.giftCount}` : event.bits != null ? `${event.bits} ${t("donations.bits")}` : event.viewerCount != null ? `${event.viewerCount} ${t("donations.viewers")}` : null;
          return <article key={event.id} className={`event-enter mb-1.5 overflow-hidden rounded-lg border transition-colors last:mb-0 ${isTop ? "border-amber-400/25 bg-linear-to-r from-amber-400/10 to-transparent" : isSelected ? "border-accent/30 bg-accent-soft" : isDone ? "border-emerald-400/25 bg-emerald-400/5" : "border-transparent bg-white/2 hover:border-line hover:bg-white/3"}`}>
            <button type="button" aria-expanded={isSelected} aria-label={t(isSelected ? "donations.collapseDonation" : "donations.expandDonation", { name })} onClick={() => setSelectedId(isSelected ? null : event.id)} className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left">
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${sourceStyles[event.source]}`}><Icon size={15} /></span>
              <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className={`max-w-full truncate text-sm font-semibold ${isTop ? "text-amber-200" : "text-ink"}`}>{name}</span><span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium text-muted">{t(`events.${event.eventType}`)}</span>{metric && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${isTop ? "bg-amber-300 text-amber-950 font-bold" : event.amount != null ? "bg-emerald-300 font-bold text-emerald-950" : "border border-line text-muted"}`}>{metric}</span>}{isTop && <Sparkles size={13} className="shrink-0 text-amber-300" />}{isDone && <Check size={13} className="shrink-0 text-emerald-400" />}</div>{!isSelected && event.message && <p className="mt-0.5 truncate text-xs text-muted">{event.message}</p>}</div>
              <span className="shrink-0 text-[11px] text-zinc-600" title={new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.timestamp))}>{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true, locale: dateLocale })}</span>
              {isSelected ? <ChevronDown size={14} className="shrink-0 text-zinc-500" /> : <ChevronRight size={14} className="shrink-0 text-zinc-600" />}
            </button>
            {isSelected && <div className="border-t border-white/6 px-3.5 pb-3 pt-3">{event.message ? <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">{event.message}</p> : <p className="text-sm italic text-zinc-600">{t("donations.noMessage")}</p>}<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted"><span className={`rounded-md px-2 py-1 font-medium ${sourceStyles[event.source]}`}>{sourceNames[event.source]}</span><span>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.timestamp))}</span></div><div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/6 pt-2"><button type="button" onClick={() => replay(event)} className={actionClass}><Play size={12} />{t("donations.replay")}</button><button type="button" onClick={() => toggleDone(event)} className={`${actionClass} ${isDone ? "text-emerald-300 hover:text-emerald-200" : "hover:text-emerald-300"}`}><Check size={12} />{t(isDone ? "donations.reopen" : "donations.markDone")}</button><button type="button" onClick={() => blockUser(event)} disabled={!event.username} title={event.username ? t("donations.block") : t("donations.blockUnavailable")} className={`${actionClass} hover:text-red-300`}><Ban size={12} />{t("donations.block")}</button>{event.message && <button type="button" onClick={() => void copyText(event.message ?? "")} className={actionClass}><Copy size={12} />{t("donations.copyText")}</button>}<button type="button" onClick={() => void copyText(event.id)} className={actionClass}><Copy size={12} />{t("donations.copyId")}</button></div></div>}
          </article>;
        })}
      </div></ScrollFade>)}
      <div className="border-t border-line bg-white/2 px-4 py-2 text-[11px] text-zinc-600">{t("donations.eventsFound", { count: tab === "activity" ? feedEvents.length : inboxFiltered.length })}</div>
    </Card>
    {selectedUser && <UserCard login={selectedUser} messages={chatMessages} onClose={() => setSelectedUser(undefined)} />}
  </>);
}

