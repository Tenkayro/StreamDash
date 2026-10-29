import {
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Inbox,
  RadioTower,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { de, enUS, es, fr, ptBR } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import { money } from "../lib/utils";
import { useAppStore } from "../stores/app-store";
import type { ActivitySource } from "../types";

type DonationSort = "newest" | "largest";

const sourceNames: Record<ActivitySource, string> = {
  twitch: "Twitch",
  streamelements: "StreamElements",
  tipeeestream: "TipeeeStream",
};

const sourceStyles: Record<ActivitySource, string> = {
  twitch: "bg-violet-400/10 text-violet-300",
  streamelements: "bg-emerald-400/10 text-emerald-300",
  tipeeestream: "bg-sky-400/10 text-sky-300",
};

export function Donations() {
  const { t, i18n } = useTranslation();
  const { events, setPage, streamElements, tipeeStream } = useAppStore();
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<ActivitySource | "all">("all");
  const [sort, setSort] = useState<DonationSort>("newest");
  const [selectedId, setSelectedId] = useState<string | null>();
  const dateLocale =
    { de, en: enUS, es, fr, "pt-BR": ptBR }[i18n.language] ?? enUS;

  const donations = useMemo(
    () => events.filter((event) => event.eventType === "donation"),
    [events],
  );
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.language);
    return donations
      .filter(
        (event) =>
          (source === "all" || event.source === source) &&
          (!needle ||
            `${event.displayName ?? ""} ${event.username ?? ""} ${event.message ?? ""}`
              .toLocaleLowerCase(i18n.language)
              .includes(needle)),
      )
      .sort((a, b) =>
        sort === "largest"
          ? (b.amount ?? 0) - (a.amount ?? 0)
          : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [donations, i18n.language, search, sort, source]);
  const totals = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const event of donations) {
      const currency = event.currency ?? "";
      grouped.set(currency, (grouped.get(currency) ?? 0) + (event.amount ?? 0));
    }
    return [...grouped.entries()];
  }, [donations]);
  const topDonationId = useMemo(
    () =>
      donations.reduce(
        (top, event) =>
          (event.amount ?? 0) > (top?.amount ?? -1) ? event : top,
        donations[0],
      )?.id,
    [donations],
  );
  const selected =
    selectedId === null
      ? undefined
      : filtered.find((event) => event.id === selectedId) ?? filtered[0];
  const connected =
    streamElements.phase === "connected" || tipeeStream.phase === "connected";

  return (
    <>
      <PageHeader
        icon={CircleDollarSign}
        title={t("nav.donations")}
        description={t("pageDescriptions.donations")}
      />

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Card className="flex min-h-20 items-center gap-3 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
            <CircleDollarSign size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {t("donations.totalReceived")}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold">
              {totals.length
                ? totals.map(([currency, value]) => money(value, currency || undefined)).join(" · ")
                : money(0)}
            </p>
          </div>
        </Card>
        <Card className="flex min-h-20 items-center gap-3 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Inbox size={17} />
          </span>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {t("donations.received")}
            </p>
            <p className="mt-0.5 text-base font-semibold">
              {t("donations.donationCount", { count: donations.length })}
            </p>
          </div>
        </Card>
        <Card className="flex min-h-20 items-center gap-3 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
            <Star size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">
              {t("donations.topDonation")}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold">
              {donations.length
                ? money(
                    donations.find((event) => event.id === topDonationId)?.amount ?? 0,
                    donations.find((event) => event.id === topDonationId)?.currency,
                  )
                : "—"}
            </p>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-2 border-b border-line bg-white/[.012] p-3 lg:grid-cols-[minmax(220px,1fr)_180px_160px]">
          <div className="relative min-w-0">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              className="input input-leading-icon input-trailing-action"
              aria-label={t("donations.searchLabel")}
              placeholder={t("donations.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                title={t("donations.clearSearch")}
                aria-label={t("donations.clearSearch")}
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="relative min-w-0">
            <RadioTower size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <select
              className="input input-leading-icon input-trailing-action appearance-none"
              aria-label={t("donations.filterSource")}
              value={source}
              onChange={(event) => setSource(event.target.value as ActivitySource | "all")}
            >
              <option value="all">{t("donations.allSources")}</option>
              <option value="streamelements">StreamElements</option>
              <option value="tipeeestream">TipeeeStream</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          </div>
          <div className="relative min-w-0">
            <SlidersHorizontal size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <select
              className="input input-leading-icon input-trailing-action appearance-none"
              aria-label={t("donations.sortLabel")}
              value={sort}
              onChange={(event) => setSort(event.target.value as DonationSort)}
            >
              <option value="newest">{t("donations.newest")}</option>
              <option value="largest">{t("donations.largest")}</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          </div>
        </div>

        {!filtered.length ? (
          <EmptyState
            icon={<CircleDollarSign size={25} />}
            title={t(donations.length ? "donations.noMatches" : "donations.empty")}
            body={t(donations.length ? "donations.tryFilters" : connected ? "donations.waiting" : "donations.emptyDetail")}
            action={!donations.length && !connected ? (
              <Button variant="primary" onClick={() => setPage("connections")}>
                {t("donations.connectServices")}
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="max-h-[calc(100vh-306px)] min-h-52 overflow-y-auto p-2">
            {filtered.map((donation) => {
              const isSelected = donation.id === selected?.id;
              const isTop = donation.id === topDonationId;
              const who = donation.displayName || donation.username || t("donations.anonymous");
              return (
                <button
                  type="button"
                  key={donation.id}
                  aria-expanded={isSelected}
                  aria-label={t(isSelected ? "donations.collapseDonation" : "donations.expandDonation", { name: who })}
                  onClick={() => setSelectedId(isSelected ? null : donation.id)}
                  className={`event-enter mb-1.5 w-full rounded-lg border px-3.5 text-left transition-colors last:mb-0 ${
                    isTop
                      ? "border-amber-400/25 bg-linear-to-r from-amber-400/10 to-transparent"
                      : isSelected
                        ? "border-accent/30 bg-accent-soft"
                        : "border-transparent bg-white/[.018] hover:border-line hover:bg-white/3"
                  }`}
                >
                  <div className="flex min-h-14 items-center gap-3 py-2.5">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${sourceStyles[donation.source]}`}>
                      {isTop ? <Star size={15} /> : <CircleDollarSign size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`truncate text-sm font-semibold ${isTop ? "text-amber-200" : "text-zinc-200"}`}>{who}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${isTop ? "bg-amber-300 text-amber-950" : "bg-emerald-300 text-emerald-950"}`}>
                          {donation.amount != null ? money(donation.amount, donation.currency) : t("events.donation")}
                        </span>
                        {isTop && <Sparkles size={13} className="shrink-0 text-amber-300" />}
                      </div>
                      {!isSelected && donation.message && (
                        <p className="mt-0.5 truncate text-xs text-muted">{donation.message}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-zinc-600">
                      {formatDistanceToNow(new Date(donation.timestamp), { addSuffix: true, locale: dateLocale })}
                    </span>
                    {isSelected ? <ChevronDown size={14} className="shrink-0 text-zinc-500" /> : <ChevronRight size={14} className="shrink-0 text-zinc-600" />}
                  </div>
                  {isSelected && (
                    <div className="border-t border-white/6 pb-3 pt-3">
                      {donation.message ? (
                        <p className="max-w-3xl whitespace-pre-wrap text-sm leading-6 text-zinc-300">{donation.message}</p>
                      ) : (
                        <p className="text-sm italic text-zinc-600">{t("donations.noMessage")}</p>
                      )}
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                        <span className={`rounded-md px-2 py-1 font-medium ${sourceStyles[donation.source]}`}>{sourceNames[donation.source]}</span>
                        <span>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(donation.timestamp))}</span>
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
