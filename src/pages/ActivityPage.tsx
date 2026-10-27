import {
  Activity,
  ChevronDown,
  ListFilter,
  RadioTower,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ActivityFeed } from "../components/ActivityFeed";
import { UserCard } from "../components/chat/UserCard";
import { Button, Card, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { clearEvents as clearNativeEvents } from "../services/native";
import type { ActivitySource, ActivityType } from "../types";
import { useTranslation } from "react-i18next";
export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const { events, chatMessages, settings, twitch, clearEvents } = useAppStore();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "all">("all");
  const [source, setSource] = useState<ActivitySource | "all">("all");
  const [selectedUser, setSelectedUser] = useState<string>();
  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (type === "all" || e.eventType === type) &&
          (source === "all" || e.source === source) &&
          `${e.displayName} ${e.username} ${e.message}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [events, search, type, source],
  );
  const remove = async () => {
    if (!confirm(t("activity.clearConfirm"))) return;
    await clearNativeEvents();
    clearEvents();
  };
  return (
    <>
      <PageHeader
        icon={Activity}
        title={t("activity.title")}
        description={
          filtered.length === events.length
            ? t("activity.eventCount", { count: events.length })
            : t("activity.filteredCount", { filtered: filtered.length.toLocaleString(i18n.language), total: events.length.toLocaleString(i18n.language) })
        }
        actions={
          <Button variant="danger" disabled={!events.length} onClick={remove}>
            <Trash2 size={14} />
            {t("activity.clearHistory")}
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-2 border-b border-line bg-white/[.012] p-3 sm:grid-cols-[minmax(220px,1fr)_190px_170px]">
          <div className="relative min-w-0">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />
            <input
              className="input input-leading-icon input-trailing-action"
              aria-label={t("activity.searchLabel")}
              placeholder={t("activity.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                title={t("activity.clearSearch")}
                aria-label={t("activity.clearSearch")}
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-zinc-300"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="relative min-w-0">
            <ListFilter
              size={14}
              className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${type === "all" ? "text-zinc-600" : "text-accent"}`}
            />
            <select
              className="input input-leading-icon input-trailing-action appearance-none capitalize"
              aria-label={t("activity.filterType")}
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType | "all")}
            >
              <option value="all">{t("activity.allTypes")}</option>
              {[
                "follow",
                "subscription",
                "resubscription",
                "gift_subscription",
                "community_gift",
                "cheer",
                "raid",
                "donation",
                "channel_point",
              ].map((v) => (
                <option value={v} key={v}>
                  {t(`events.${v}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />
          </div>
          <div className="relative min-w-0">
            <RadioTower
              size={14}
              className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${source === "all" ? "text-zinc-600" : "text-accent"}`}
            />
            <select
              className="input input-leading-icon input-trailing-action appearance-none"
              aria-label={t("activity.filterSource")}
              value={source}
              onChange={(e) =>
                setSource(e.target.value as ActivitySource | "all")
              }
            >
              <option value="all">{t("activity.allSources")}</option>
              <option value="twitch">Twitch</option>
              <option value="streamelements">StreamElements</option>
            </select>
            <ChevronDown
              size={13}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />
          </div>
        </div>
        <div className="max-h-[calc(100vh-210px)] overflow-y-auto">
          <ActivityFeed
            events={filtered}
            compact={settings.compactFeed}
            onUser={
              twitch.phase === "connected" ? setSelectedUser : undefined
            }
            emptyTitle={events.length ? t("activity.noMatches") : t("activity.empty")}
            emptyBody={
              events.length
                ? t("activity.tryFilters")
                : undefined
            }
          />
        </div>
      </Card>
      {selectedUser && (
        <UserCard
          login={selectedUser}
          messages={chatMessages}
          onClose={() => setSelectedUser(undefined)}
        />
      )}
    </>
  );
}
