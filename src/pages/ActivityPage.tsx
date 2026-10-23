import { Search, Trash2 } from "lucide-react";
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
        description={`${filtered.length.toLocaleString("en-US")} events`}
        actions={
          <Button variant="danger" onClick={remove}>
            <Trash2 size={14} />
            Clear history
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-3 text-zinc-600" />
            <input
              className="input pl-9"
              placeholder="Search activity"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input w-44"
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
          <select
            className="input w-40"
            value={source}
            onChange={(e) =>
              setSource(e.target.value as ActivitySource | "all")
            }
          >
            <option value="all">All sources</option>
            <option value="twitch">Twitch</option>
            <option value="streamelements">StreamElements</option>
          </select>
        </div>
        <div className="max-h-[calc(100vh-210px)] overflow-y-auto">
          <ActivityFeed events={filtered} compact={settings.compactFeed} />
        </div>
      </Card>
    </>
  );
}
