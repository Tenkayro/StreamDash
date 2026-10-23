import {
  ChevronDown,
  ListFilter,
  RadioTower,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ActivityFeed } from "../components/ActivityFeed";
import { Button, Card, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { clearEvents as clearNativeEvents } from "../services/native";
import type { ActivitySource, ActivityType } from "../types";
export function ActivityPage() {
  const { events, settings, clearEvents } = useAppStore();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ActivityType | "all">("all");
  const [source, setSource] = useState<ActivitySource | "all">("all");
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
    if (!confirm("Clear all activity? This cannot be undone.")) return;
    await clearNativeEvents();
    clearEvents();
  };
  return (
    <>
      <PageHeader
        title="Activity"
        description={
          filtered.length === events.length
            ? `${events.length.toLocaleString("en-US")} events`
            : `${filtered.length.toLocaleString("en-US")} of ${events.length.toLocaleString("en-US")} events`
        }
        actions={
          <Button variant="danger" disabled={!events.length} onClick={remove}>
            <Trash2 size={14} />
            Clear history
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
              className="input pl-9 pr-9"
              aria-label="Search activity"
              placeholder="Search people, messages or events"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                title="Clear search"
                aria-label="Clear search"
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
              className="input appearance-none pl-9 pr-8 capitalize"
              aria-label="Filter by event type"
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType | "all")}
            >
              <option value="all">All event types</option>
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
                  {v.replaceAll("_", " ")}
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
              className="input appearance-none pl-9 pr-8"
              aria-label="Filter by source"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as ActivitySource | "all")
              }
            >
              <option value="all">All sources</option>
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
            emptyTitle={events.length ? "No matching activity" : "No activity yet"}
            emptyBody={
              events.length
                ? "Try a different search or reset one of the filters."
                : undefined
            }
          />
        </div>
      </Card>
    </>
  );
}
