import {
  BellOff,
  CircleDollarSign,
  Gift,
  Heart,
  Radio,
  Sparkles,
  Star,
  Users,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ActivityEvent } from "../types";
import { money } from "../lib/utils";
import { EmptyState } from "./ui";
const presentation = {
  follow: [Heart, "Follow", "text-pink-300 bg-pink-400/10"],
  subscription: [Star, "Subscription", "text-violet-300 bg-violet-400/10"],
  resubscription: [Star, "Resubscription", "text-violet-300 bg-violet-400/10"],
  gift_subscription: [Gift, "Gifted sub", "text-sky-300 bg-sky-400/10"],
  community_gift: [Gift, "Community gift", "text-sky-300 bg-sky-400/10"],
  cheer: [Sparkles, "Cheer", "text-amber-300 bg-amber-400/10"],
  raid: [Users, "Raid", "text-orange-300 bg-orange-400/10"],
  donation: [
    CircleDollarSign,
    "Donation",
    "text-emerald-300 bg-emerald-400/10",
  ],
  channel_point: [Sparkles, "Redemption", "text-cyan-300 bg-cyan-400/10"],
  stream_online: [Radio, "Stream online", "text-emerald-300 bg-emerald-400/10"],
  stream_offline: [Radio, "Stream offline", "text-zinc-400 bg-white/5"],
  other: [Radio, "Activity", "text-zinc-400 bg-white/5"],
} as const;
export function ActivityFeed({
  events,
  limit,
  compact = false,
  emptyTitle = "No activity yet",
  emptyBody,
  onUser,
}: {
  events: ActivityEvent[];
  limit?: number;
  compact?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  onUser?: (login: string) => void;
}) {
  const shown = limit ? events.slice(0, limit) : events;
  if (!shown.length)
    return (
      <EmptyState
        icon={<BellOff size={24} />}
        title={emptyTitle}
        body={emptyBody}
      />
    );
  return (
    <div>
      {shown.map((event) => {
        const [Icon, label, color] = presentation[event.eventType];
        const who = event.displayName || event.username || "Anonymous";
        let detail: string = label;
        if (event.amount != null) detail = money(event.amount, event.currency);
        else if (event.bits)
          detail = `${event.bits.toLocaleString("en-US")} bits`;
        else if (event.giftCount) detail = `${event.giftCount} gifted subs`;
        else if (event.viewerCount)
          detail = `${event.viewerCount.toLocaleString("en-US")} viewers`;
        const canOpenUser = Boolean(event.username && onUser);
        return (
          <div
            key={event.id}
            role={canOpenUser ? "button" : undefined}
            tabIndex={canOpenUser ? 0 : undefined}
            title={canOpenUser ? `Open ${who}'s user card` : undefined}
            onClick={() => {
              if (event.username) onUser?.(event.username);
            }}
            onKeyDown={(keyboardEvent) => {
              if (
                event.username &&
                (keyboardEvent.key === "Enter" || keyboardEvent.key === " ")
              ) {
                keyboardEvent.preventDefault();
                onUser?.(event.username);
              }
            }}
            className={`event-enter flex gap-3 border-b border-line/70 px-4 transition-colors ${compact ? "py-2.5" : "py-3.5"} ${canOpenUser ? "cursor-pointer outline-none hover:bg-white/[.025] focus-visible:bg-accent-soft" : ""} last:border-0`}
          >
            <div
              className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${color}`}
            >
              <Icon size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{who}</span>
                <span className="text-xs text-muted">{detail}</span>
              </div>
              {event.message && (
                <p className="mt-1 truncate text-xs text-zinc-500">
                  “{event.message}”
                </p>
              )}
            </div>
            <div className="shrink-0 text-[11px] text-zinc-600">
              {formatDistanceToNow(new Date(event.timestamp), {
                addSuffix: true,
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
