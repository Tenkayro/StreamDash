import i18n, { resolveLanguage } from "../i18n";
import { money } from "./utils";
import type { useAppStore } from "../stores/app-store";

export type VariableCategory =
  | "stream"
  | "stats"
  | "user"
  | "events"
  | "tools"
  | "utility";

export interface VariableDefinition {
  key: string;
  token: string;
  aliases?: string[];
  category: VariableCategory;
  descriptionKey: string;
}

export const VARIABLE_DEFINITIONS: VariableDefinition[] = [
  // Stream & Channel
  {
    key: "channel",
    token: "$(channel)",
    aliases: ["$(channel.display_name)", "{channel}"],
    category: "stream",
    descriptionKey: "variables.items.channel",
  },
  {
    key: "title",
    token: "$(title)",
    aliases: ["$(stream.title)", "{title}"],
    category: "stream",
    descriptionKey: "variables.items.title",
  },
  {
    key: "game",
    token: "$(game)",
    aliases: ["$(category)", "{game}"],
    category: "stream",
    descriptionKey: "variables.items.game",
  },
  {
    key: "status",
    token: "$(status)",
    aliases: ["$(stream.status)"],
    category: "stream",
    descriptionKey: "variables.items.status",
  },
  {
    key: "uptime",
    token: "$(uptime)",
    aliases: ["$(stream.uptime)", "{uptime}"],
    category: "stream",
    descriptionKey: "variables.items.uptime",
  },
  {
    key: "viewers",
    token: "$(viewers)",
    aliases: ["$(stream.viewers)", "{viewers}"],
    category: "stream",
    descriptionKey: "variables.items.viewers",
  },
  {
    key: "bot",
    token: "$(bot)",
    aliases: ["{bot}"],
    category: "stream",
    descriptionKey: "variables.items.bot",
  },

  // Stats & Counters
  {
    key: "followers",
    token: "$(followers)",
    aliases: ["$(followers.count)", "{followers}"],
    category: "stats",
    descriptionKey: "variables.items.followers",
  },
  {
    key: "subscribers",
    token: "$(subscribers)",
    aliases: ["$(subs)", "$(subs.count)", "{subscribers}", "{subs}"],
    category: "stats",
    descriptionKey: "variables.items.subscribers",
  },
  {
    key: "bits.total",
    token: "$(bits.total)",
    aliases: ["{bits.total}"],
    category: "stats",
    descriptionKey: "variables.items.bitsTotal",
  },
  {
    key: "donations.total",
    token: "$(donations.total)",
    aliases: ["{donations.total}"],
    category: "stats",
    descriptionKey: "variables.items.donationsTotal",
  },
  {
    key: "raids.count",
    token: "$(raids.count)",
    aliases: ["{raids.count}"],
    category: "stats",
    descriptionKey: "variables.items.raidsCount",
  },
  {
    key: "gifts.count",
    token: "$(gifts.count)",
    aliases: ["{gifts.count}"],
    category: "stats",
    descriptionKey: "variables.items.giftsCount",
  },
  {
    key: "events.count",
    token: "$(events.count)",
    aliases: ["{events.count}"],
    category: "stats",
    descriptionKey: "variables.items.eventsCount",
  },
  {
    key: "chat.messages",
    token: "$(chat.messages)",
    aliases: ["{chat.messages}"],
    category: "stats",
    descriptionKey: "variables.items.chatMessages",
  },
  {
    key: "commands.count",
    token: "$(commands.count)",
    aliases: ["{commands.count}"],
    category: "stats",
    descriptionKey: "variables.items.commandsCount",
  },
  {
    key: "count",
    token: "$(count)",
    aliases: ["$(command.count)", "{count}"],
    category: "stats",
    descriptionKey: "variables.items.count",
  },

  // User & Command Context
  {
    key: "user",
    token: "$(user)",
    aliases: ["{user}"],
    category: "user",
    descriptionKey: "variables.items.user",
  },
  {
    key: "user.login",
    token: "$(user.login)",
    aliases: ["{user.login}"],
    category: "user",
    descriptionKey: "variables.items.userLogin",
  },
  {
    key: "touser",
    token: "$(touser)",
    aliases: ["$(target)", "{touser}"],
    category: "user",
    descriptionKey: "variables.items.touser",
  },
  {
    key: "query",
    token: "$(query)",
    aliases: ["$(args)", "{query}"],
    category: "user",
    descriptionKey: "variables.items.query",
  },
  {
    key: "arg1",
    token: "$(arg1)",
    aliases: ["$(1)", "{arg1}"],
    category: "user",
    descriptionKey: "variables.items.arg1",
  },
  {
    key: "arg2",
    token: "$(arg2)",
    aliases: ["$(2)", "{arg2}"],
    category: "user",
    descriptionKey: "variables.items.arg2",
  },

  // Latest Events & Alert Data
  {
    key: "last.follower",
    token: "$(last.follower)",
    aliases: ["{last.follower}"],
    category: "events",
    descriptionKey: "variables.items.lastFollower",
  },
  {
    key: "last.sub",
    token: "$(last.sub)",
    aliases: ["$(last.subscriber)", "{last.sub}"],
    category: "events",
    descriptionKey: "variables.items.lastSub",
  },
  {
    key: "last.resub",
    token: "$(last.resub)",
    aliases: ["{last.resub}"],
    category: "events",
    descriptionKey: "variables.items.lastResub",
  },
  {
    key: "last.gifter",
    token: "$(last.gifter)",
    aliases: ["{last.gifter}"],
    category: "events",
    descriptionKey: "variables.items.lastGifter",
  },
  {
    key: "last.cheer",
    token: "$(last.cheer)",
    aliases: ["{last.cheer}"],
    category: "events",
    descriptionKey: "variables.items.lastCheer",
  },
  {
    key: "last.raider",
    token: "$(last.raider)",
    aliases: ["{last.raider}"],
    category: "events",
    descriptionKey: "variables.items.lastRaider",
  },
  {
    key: "last.donation",
    token: "$(last.donation)",
    aliases: ["{last.donation}"],
    category: "events",
    descriptionKey: "variables.items.lastDonation",
  },
  {
    key: "last.redemption",
    token: "$(last.redemption)",
    aliases: ["{last.redemption}"],
    category: "events",
    descriptionKey: "variables.items.lastRedemption",
  },
  {
    key: "months",
    token: "$(months)",
    aliases: ["{months}"],
    category: "events",
    descriptionKey: "variables.items.months",
  },
  {
    key: "recipient",
    token: "$(recipient)",
    aliases: ["{recipient}"],
    category: "events",
    descriptionKey: "variables.items.recipient",
  },
  {
    key: "amount",
    token: "$(amount)",
    aliases: ["{amount}"],
    category: "events",
    descriptionKey: "variables.items.amount",
  },
  {
    key: "bits",
    token: "$(bits)",
    aliases: ["{bits}"],
    category: "events",
    descriptionKey: "variables.items.bits",
  },
  {
    key: "tier",
    token: "$(tier)",
    aliases: ["{tier}"],
    category: "events",
    descriptionKey: "variables.items.tier",
  },

  // Goals & Giveaway
  {
    key: "goal.followers",
    token: "$(goal.followers)",
    aliases: ["{goal.followers}"],
    category: "tools",
    descriptionKey: "variables.items.goalFollowers",
  },
  {
    key: "goal.subscribers",
    token: "$(goal.subscribers)",
    aliases: ["$(goal.subs)", "{goal.subscribers}"],
    category: "tools",
    descriptionKey: "variables.items.goalSubscribers",
  },
  {
    key: "goal.donations",
    token: "$(goal.donations)",
    aliases: ["{goal.donations}"],
    category: "tools",
    descriptionKey: "variables.items.goalDonations",
  },
  {
    key: "goal.bits",
    token: "$(goal.bits)",
    aliases: ["{goal.bits}"],
    category: "tools",
    descriptionKey: "variables.items.goalBits",
  },
  {
    key: "giveaway.status",
    token: "$(giveaway.status)",
    aliases: ["{giveaway.status}"],
    category: "tools",
    descriptionKey: "variables.items.giveawayStatus",
  },
  {
    key: "giveaway.keyword",
    token: "$(giveaway.keyword)",
    aliases: ["{giveaway.keyword}"],
    category: "tools",
    descriptionKey: "variables.items.giveawayKeyword",
  },
  {
    key: "giveaway.entries",
    token: "$(giveaway.entries)",
    aliases: ["{giveaway.entries}"],
    category: "tools",
    descriptionKey: "variables.items.giveawayEntries",
  },
  {
    key: "giveaway.winner",
    token: "$(giveaway.winner)",
    aliases: ["{giveaway.winner}"],
    category: "tools",
    descriptionKey: "variables.items.giveawayWinner",
  },

  // Music, OBS & Utility
  {
    key: "song",
    token: "$(song)",
    aliases: ["$(spotify.song)", "{song}"],
    category: "utility",
    descriptionKey: "variables.items.song",
  },
  {
    key: "obs.scene",
    token: "$(obs.scene)",
    aliases: ["{obs.scene}"],
    category: "utility",
    descriptionKey: "variables.items.obsScene",
  },
  {
    key: "obs.fps",
    token: "$(obs.fps)",
    aliases: ["{obs.fps}"],
    category: "utility",
    descriptionKey: "variables.items.obsFps",
  },
  {
    key: "time",
    token: "$(time)",
    aliases: ["{time}"],
    category: "utility",
    descriptionKey: "variables.items.time",
  },
  {
    key: "date",
    token: "$(date)",
    aliases: ["{date}"],
    category: "utility",
    descriptionKey: "variables.items.date",
  },
  {
    key: "random",
    token: "$(random.1-100)",
    aliases: ["$(random)", "{random}"],
    category: "utility",
    descriptionKey: "variables.items.random",
  },
];

export interface VariableResolutionContext {
  state: ReturnType<typeof useAppStore.getState>;
  user?: string;
  userLogin?: string;
  rawMessageText?: string;
  commandCount?: number;
  songText?: string;
  alertData?: {
    months?: number;
    recipient?: string;
    amount?: number | string;
    bits?: number;
    viewers?: number;
    tier?: string;
    game?: string;
    title?: string;
  };
  deterministicPreview?: boolean;
}

function formatUptime(startedAt: string | undefined, lng: string): string {
  if (!startedAt) return i18n.t("stream.offline", { lng });
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function buildVariableMap(
  ctx: VariableResolutionContext,
): Record<string, string> {
  const { state, alertData, deterministicPreview } = ctx;
  const lng = resolveLanguage(state.settings.language);
  const channel =
    state.twitch.account ||
    i18n.t("variables.fallbackChannel", { lng, defaultValue: "Streamer" });
  const bot = state.twitchBot.account || channel;
  const user = ctx.user || state.twitch.account || "Viewer";
  const userLogin = (ctx.userLogin || user).toLowerCase();

  const tokens = (ctx.rawMessageText ?? "").trim().split(/\s+/).slice(1);
  const query = tokens.join(" ");
  const arg1 = tokens[0] ?? "";
  const arg2 = tokens[1] ?? "";
  const arg3 = tokens[2] ?? "";
  const touser = arg1 ? arg1.replace(/^@+/, "") : user;

  const title = alertData?.title ?? state.stats.title ?? "—";
  const game = alertData?.game ?? state.stats.category ?? "—";
  const status = state.stats.live
    ? i18n.t("stream.live", { lng })
    : i18n.t("stream.offline", { lng });
  const uptime = formatUptime(state.stats.startedAt, lng);
  const viewers =
    alertData?.viewers != null
      ? String(alertData.viewers)
      : state.stats.viewers != null
        ? state.stats.viewers.toLocaleString(lng)
        : "0";

  const followers =
    state.stats.followers != null
      ? state.stats.followers.toLocaleString(lng)
      : "0";
  const subscribers =
    state.stats.subscribers != null
      ? state.stats.subscribers.toLocaleString(lng)
      : "0";
  const bitsTotal = state.stats.bits.toLocaleString(lng);
  const donationsTotal = money(
    state.stats.donations,
    state.stats.donationCurrency,
  );
  const raidEvents = state.events.filter((e) => e.eventType === "raid");
  const raidsCount = raidEvents.length.toLocaleString(lng);
  const giftsCount = state.events
    .reduce(
      (sum, e) =>
        sum +
        (e.eventType === "community_gift"
          ? (e.giftCount ?? 1)
          : e.eventType === "gift_subscription"
            ? 1
            : 0),
      0,
    )
    .toLocaleString(lng);
  const eventsCount = state.events.length.toLocaleString(lng);
  const chatMessagesCount = state.chatMessages.filter((m) => !m.deleted).length.toLocaleString(lng);
  const commandsCount = state.commands.filter((c) => c.enabled).length.toString();
  const count = String(ctx.commandCount ?? 1);

  const findLatestUser = (types: string[]) => {
    const ev = state.events.find((e) => types.includes(e.eventType));
    return ev?.displayName || ev?.username || "—";
  };
  const lastFollower = findLatestUser(["follow"]);
  const lastSub = findLatestUser(["subscription"]);
  const lastResub = findLatestUser(["resubscription"]);
  const lastGifter = findLatestUser(["gift_subscription", "community_gift"]);
  const lastCheerEvent = state.events.find((e) => e.eventType === "cheer");
  const lastCheer = lastCheerEvent
    ? `${lastCheerEvent.displayName || lastCheerEvent.username || "—"} (${lastCheerEvent.bits ?? 0} Bits)`
    : "—";
  const lastRaidEvent = raidEvents[0];
  const lastRaider = lastRaidEvent
    ? `${lastRaidEvent.displayName || lastRaidEvent.username || "—"} (${lastRaidEvent.viewerCount ?? 0})`
    : "—";
  const lastDonationEvent = state.events.find((e) => e.eventType === "donation");
  const lastDonation = lastDonationEvent
    ? `${lastDonationEvent.displayName || lastDonationEvent.username || "—"} (${money(lastDonationEvent.amount ?? 0, lastDonationEvent.currency)})`
    : "—";
  const lastRedemptionEvent = state.events.find(
    (e) => e.eventType === "channel_point",
  );
  const lastRedemption = lastRedemptionEvent
    ? `${lastRedemptionEvent.displayName || lastRedemptionEvent.username || "—"}${lastRedemptionEvent.message ? ` (${lastRedemptionEvent.message})` : ""}`
    : "—";

  const goalText = (current: number | undefined, target: number | undefined, isMoney = false) => {
    const cur = isMoney
      ? money(current ?? 0, state.stats.donationCurrency)
      : (current ?? 0).toLocaleString(lng);
    if (!target) return cur;
    const tgt = isMoney
      ? money(target, state.stats.donationCurrency)
      : target.toLocaleString(lng);
    return `${cur} / ${tgt}`;
  };

  const giveawayStatus = state.giveaway.running
    ? i18n.t("giveaways.running", { lng })
    : i18n.t("giveaways.stopped", { lng });
  const giveawayKeyword =
    state.giveaway.type === "keyword"
      ? state.giveaway.keyword
      : i18n.t("giveaways.activeUsers", { lng });
  const giveawayEntries = String(state.giveaway.entries.length);
  const giveawayWinner = state.giveaway.winner?.displayName ?? "—";

  const now = new Date();
  const timeStr = now.toLocaleTimeString(lng, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateStr = now.toLocaleDateString(lng);
  const randomVal = deterministicPreview
    ? "42"
    : String(Math.floor(Math.random() * 100) + 1);

  const map: Record<string, string> = {
    channel,
    "channel.display_name": channel,
    title,
    "stream.title": title,
    game,
    category: game,
    status,
    "stream.status": status,
    uptime,
    "stream.uptime": uptime,
    viewers,
    "stream.viewers": viewers,
    bot,

    followers,
    "followers.count": followers,
    subscribers,
    subs: subscribers,
    "subs.count": subscribers,
    "bits.total": bitsTotal,
    "donations.total": donationsTotal,
    "raids.count": raidsCount,
    "gifts.count": giftsCount,
    "events.count": eventsCount,
    "chat.messages": chatMessagesCount,
    "commands.count": commandsCount,
    count,
    "command.count": count,

    user,
    "user.login": userLogin,
    touser,
    target: touser,
    query,
    args: query,
    arg1,
    "1": arg1,
    arg2,
    "2": arg2,
    arg3,
    "3": arg3,

    "last.follower": lastFollower,
    "last.sub": lastSub,
    "last.subscriber": lastSub,
    "last.resub": lastResub,
    "last.gifter": lastGifter,
    "last.cheer": lastCheer,
    "last.raider": lastRaider,
    "last.donation": lastDonation,
    "last.redemption": lastRedemption,

    months: String(alertData?.months ?? 1),
    recipient: alertData?.recipient || user,
    amount: String(alertData?.amount ?? 1),
    bits: String(alertData?.bits ?? state.stats.bits ?? 0),
    tier: alertData?.tier ?? "Tier 1",

    "goal.followers": goalText(state.stats.followers, state.settings.goals.followers),
    "goal.subscribers": goalText(state.stats.subscribers, state.settings.goals.subscribers),
    "goal.subs": goalText(state.stats.subscribers, state.settings.goals.subscribers),
    "goal.donations": goalText(state.stats.donations, state.settings.goals.donations, true),
    "goal.bits": goalText(state.stats.bits, state.settings.goals.bits),

    "giveaway.status": giveawayStatus,
    "giveaway.keyword": giveawayKeyword,
    "giveaway.entries": giveawayEntries,
    "giveaway.winner": giveawayWinner,

    song: ctx.songText || "—",
    "spotify.song": ctx.songText || "—",
    "obs.scene": state.obsSnapshot?.scene || "—",
    "obs.fps":
      state.obsSnapshot?.fps != null
        ? `${Math.round(state.obsSnapshot.fps)} FPS`
        : "—",
    time: timeStr,
    date: dateStr,
    random: randomVal,
    "random.1-100": randomVal,
  };

  for (const custom of state.customVariables) {
    const key = custom.name.toLowerCase();
    map[key] = custom.value;
    map[`custom.${key}`] = custom.value;
  }

  return map;
}

export function resolveVariables(
  template: string,
  ctx: VariableResolutionContext,
): string {
  if (!template) return "";
  const map = buildVariableMap(ctx);

  return template.replace(
    /\$\(([^)]+)\)|\{([^}]+)\}/g,
    (fullMatch, dollarKey?: string, braceKey?: string) => {
      const rawKey = (dollarKey ?? braceKey ?? "").trim().toLowerCase();
      if (!rawKey) return fullMatch;

      const randomMatch = /^random\.(\d+)-(\d+)$/.exec(rawKey);
      if (randomMatch) {
        const min = Number.parseInt(randomMatch[1], 10);
        const max = Number.parseInt(randomMatch[2], 10);
        if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
          if (ctx.deterministicPreview) {
            return String(Math.floor((min + max) / 2));
          }
          return String(Math.floor(Math.random() * (max - min + 1)) + min);
        }
      }

      if (rawKey in map) {
        return map[rawKey];
      }
      return fullMatch;
    },
  );
}
