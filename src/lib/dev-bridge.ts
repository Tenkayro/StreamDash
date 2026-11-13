import { invoke, isTauri } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { formatCrashReport, useCrashStore } from "../stores/crash-store";
import { useNetworkStore } from "../stores/network-store";
import { useAppStore } from "../stores/app-store";
import type { ActivityEvent, ChatMessage } from "../types";

export const DEV_CHANNEL_NAME = "streamdash-devtools";
export const DEV_RENDER_CRASH_EVENT = "streamdash:dev-render-crash";

export interface DevCrashSummary {
  id: string;
  timestamp: string;
  kind: string;
  message: string;
  fatal: boolean;
  report: string;
}

export interface DevStateSnapshot {
  updatedAt: number;
  page: string;
  pageHistory: string[];
  online: boolean;
  networkChecking: boolean;
  pro: boolean;
  tier: "free" | "pro";
  cloudSyncEnabled: boolean;
  cloudSyncPhase: string;
  language: string;
  density: string;
  connections: {
    twitch: { phase: string; account?: string };
    twitchBot: { phase: string; account?: string };
    obs: { phase: string };
    streamElements: { phase: string };
    tipeeStream: { phase: string };
  };
  stats: {
    live: boolean;
    viewers: number;
    followers: number;
    chatCount: number;
    eventCount: number;
  };
  crashes: DevCrashSummary[];
}

export type DevCommand =
  | { type: "request-state" }
  | { type: "crash-render" }
  | { type: "crash-runtime" }
  | { type: "crash-promise" }
  | { type: "crash-api" }
  | { type: "clear-crashes" }
  | { type: "set-online"; online: boolean }
  | { type: "check-network" }
  | { type: "set-pro"; pro: boolean }
  | { type: "navigate"; page: string }
  | { type: "set-language"; language: "en" | "de" | "es" | "fr" | "pt-BR" }
  | {
      type: "toast";
      variant: "success" | "info" | "warning" | "error";
      message: string;
    }
  | {
      type: "simulate-event";
      eventType:
        | "follow"
        | "subscription"
        | "subscription_prime"
        | "subscription_tier2"
        | "subscription_tier3"
        | "resubscription"
        | "gift_subscription"
        | "community_gift"
        | "raid"
        | "cheer"
        | "donation_se"
        | "donation_tipeee"
        | "channel_point"
        | "stream_online"
        | "stream_offline";
    }
  | { type: "simulate-chat"; text?: string; username?: string }
  | { type: "simulate-giveaway-entry" }
  | { type: "toggle-live" }
  | {
      type: "bump-stats";
      viewers?: number;
      followers?: number;
      bits?: number;
      donations?: number;
    }
  | {
      type: "set-connection";
      target: "twitch" | "twitchBot" | "obs" | "streamElements" | "tipeeStream";
      phase: "connected" | "disconnected" | "error";
    }
  | { type: "reload" };

export async function openDevToolsWindow(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (isTauri()) {
    try {
      await invoke("open_devtools_window");
      return;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  const url = `${window.location.origin}${window.location.pathname}?devtools=1`;
  window.open(url, "streamdash-devtools", "width=560,height=760,resizable=yes");
}

function buildDevSnapshot(): DevStateSnapshot {
  const app = useAppStore.getState();
  const network = useNetworkStore.getState();
  const crashes = useCrashStore.getState();

  return {
    updatedAt: Date.now(),
    page: app.page,
    pageHistory: app.pageHistory.slice(-8),
    online: network.online,
    networkChecking: network.checking,
    pro: app.entitlements.pro,
    tier: app.entitlements.tier,
    cloudSyncEnabled: app.cloudSyncEnabled,
    cloudSyncPhase: app.cloudSync.phase,
    language: app.settings.language,
    density: app.settings.uiDensity,
    connections: {
      twitch: { phase: app.twitch.phase, account: app.twitch.account },
      twitchBot: { phase: app.twitchBot.phase, account: app.twitchBot.account },
      obs: { phase: app.obs.phase },
      streamElements: { phase: app.streamElements.phase },
      tipeeStream: { phase: app.tipeeStream.phase },
    },
    stats: {
      live: app.stats.live,
      viewers: app.stats.viewers ?? 0,
      followers: app.stats.followers ?? 0,
      chatCount: app.chatMessages.length,
      eventCount: app.events.length,
    },
    crashes: crashes.history.slice(0, 8).map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      kind: entry.kind,
      message: entry.message,
      fatal: Boolean(entry.fatal),
      report: formatCrashReport(entry, crashes.history),
    })),
  };
}

type SimulatedEventKind = Extract<DevCommand, { type: "simulate-event" }>["eventType"];

function pushSimulatedEvent(eventType: SimulatedEventKind) {
  const now = new Date().toISOString();
  const id = `dev-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const samples: Record<SimulatedEventKind, ActivityEvent> = {
    follow: {
      id,
      source: "twitch",
      eventType: "follow",
      username: "dev_viewer",
      displayName: "DevViewer",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    subscription: {
      id,
      source: "twitch",
      eventType: "subscription",
      username: "dev_sub",
      displayName: "DevSubscriber",
      tier: "1000",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    subscription_prime: {
      id,
      source: "twitch",
      eventType: "subscription",
      username: "dev_prime",
      displayName: "DevPrime",
      tier: "1000",
      timestamp: now,
      metadata: { devSimulated: true, isPrime: true },
    },
    subscription_tier2: {
      id,
      source: "twitch",
      eventType: "subscription",
      username: "dev_sub_t2",
      displayName: "DevTier2",
      tier: "2000",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    subscription_tier3: {
      id,
      source: "twitch",
      eventType: "subscription",
      username: "dev_sub_t3",
      displayName: "DevTier3",
      tier: "3000",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    resubscription: {
      id,
      source: "twitch",
      eventType: "resubscription",
      username: "dev_resub",
      displayName: "DevResub",
      tier: "1000",
      message: "6 months streak! Pog",
      timestamp: now,
      metadata: { devSimulated: true, cumulativeMonths: 6 },
    },
    gift_subscription: {
      id,
      source: "twitch",
      eventType: "gift_subscription",
      username: "dev_gifter",
      displayName: "DevGifter",
      tier: "1000",
      giftCount: 1,
      timestamp: now,
      metadata: { devSimulated: true },
    },
    community_gift: {
      id,
      source: "twitch",
      eventType: "community_gift",
      username: "dev_whale",
      displayName: "DevWhale",
      tier: "1000",
      giftCount: 5,
      timestamp: now,
      metadata: { devSimulated: true },
    },
    raid: {
      id,
      source: "twitch",
      eventType: "raid",
      username: "dev_raider",
      displayName: "DevRaider",
      viewerCount: 42,
      timestamp: now,
      metadata: { devSimulated: true },
    },
    cheer: {
      id,
      source: "twitch",
      eventType: "cheer",
      username: "dev_cheerer",
      displayName: "DevCheerer",
      bits: 500,
      message: "DevTools test cheer! PogChamp",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    donation_se: {
      id,
      source: "streamelements",
      eventType: "donation",
      username: "dev_donor",
      displayName: "DevDonor",
      amount: 10,
      currency: "EUR",
      message: "StreamElements test donation!",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    donation_tipeee: {
      id,
      source: "tipeeestream",
      eventType: "donation",
      username: "dev_tipeee",
      displayName: "DevTipeee",
      amount: 5,
      currency: "EUR",
      message: "TipeeeStream test donation!",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    channel_point: {
      id,
      source: "twitch",
      eventType: "channel_point",
      username: "dev_redeemer",
      displayName: "DevRedeemer",
      message: "Hydrate!",
      timestamp: now,
      metadata: { devSimulated: true, rewardTitle: "Hydrate!", cost: 250 },
    },
    stream_online: {
      id,
      source: "twitch",
      eventType: "stream_online",
      timestamp: now,
      metadata: { devSimulated: true },
    },
    stream_offline: {
      id,
      source: "twitch",
      eventType: "stream_offline",
      timestamp: now,
      metadata: { devSimulated: true },
    },
  };

  useAppStore.getState().pushEvent(samples[eventType]);
  toast.success(`Simulated ${eventType} event`);
}

function pushSimulatedChat(text?: string, username?: string) {
  const cleanUser = (username || "devtools_user").trim();
  const body =
    (text || "").trim() ||
    "Hello from StreamDash DevTools! This is a simulated chat message.";
  const msg: ChatMessage = {
    id: `dev-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    login: cleanUser.toLowerCase().replace(/\s+/g, "_"),
    displayName: cleanUser,
    color: "#9147ff",
    badges: [],
    timestamp: Date.now(),
    text: body,
    parts: [{ type: "text", text: body }],
  };
  const app = useAppStore.getState();
  app.pushChatMessage(msg);
  app.ingestGiveawayChatMessage(msg, app.twitchBot.account);
  toast.info(`Chat: ${cleanUser}`);
}

export function installDevBridge(): () => void {
  if (!import.meta.env.DEV || typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  const channel = new BroadcastChannel(DEV_CHANNEL_NAME);
  let timer: number | undefined;

  const broadcastState = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      channel.postMessage({ type: "state", snapshot: buildDevSnapshot() });
    }, 30);
  };

  const unsubApp = useAppStore.subscribe(broadcastState);
  const unsubNet = useNetworkStore.subscribe(broadcastState);
  const unsubCrash = useCrashStore.subscribe(broadcastState);

  channel.onmessage = (event: MessageEvent<DevCommand>) => {
    const cmd = event.data;
    if (!cmd || typeof cmd !== "object" || !("type" in cmd)) return;

    switch (cmd.type) {
      case "request-state":
        channel.postMessage({ type: "state", snapshot: buildDevSnapshot() });
        break;
      case "crash-render":
        window.dispatchEvent(new CustomEvent(DEV_RENDER_CRASH_EVENT));
        break;
      case "crash-runtime":
        window.setTimeout(() => {
          throw new Error("DevTools: Simulated uncaught runtime error");
        }, 0);
        break;
      case "crash-promise":
        void Promise.reject(
          new Error("DevTools: Simulated unhandled promise rejection"),
        );
        break;
      case "crash-api":
        useCrashStore.getState().reportCrash({
          kind: "api",
          message: "DevTools: Simulated API error (502 Bad Gateway)",
          stack: new Error("Simulated API error (502 Bad Gateway)").stack,
          page: useAppStore.getState().page,
          fatal: false,
        });
        break;
      case "clear-crashes":
        useCrashStore.getState().clearHistory();
        toast.info("Crash history cleared");
        break;
      case "set-online":
        useNetworkStore.setState({
          online: cmd.online,
          checking: false,
        });
        toast(cmd.online ? "Simulated Online mode" : "Simulated Offline mode");
        break;
      case "check-network":
        void useNetworkStore.getState().checkNow();
        break;
      case "set-pro":
        useAppStore.getState().setEntitlements({
          tier: cmd.pro ? "pro" : "free",
          pro: cmd.pro,
          features: cmd.pro
            ? ["cloud_sync", "pro_themes", "unlimited_profiles"]
            : [],
        });
        toast.info(`Pro entitlements simulated: ${cmd.pro ? "PRO" : "FREE"}`);
        break;
      case "navigate":
        useAppStore.getState().setPage(cmd.page);
        break;
      case "set-language":
        useAppStore.getState().setSettings({ language: cmd.language });
        break;
      case "toast":
        toast[cmd.variant](cmd.message);
        break;
      case "simulate-event":
        pushSimulatedEvent(cmd.eventType);
        break;
      case "simulate-chat":
        pushSimulatedChat(cmd.text, cmd.username);
        break;
      case "simulate-giveaway-entry": {
        const app = useAppStore.getState();
        const kw = app.giveaway.keyword || "!join";
        const suffix = Math.floor(Math.random() * 900 + 100);
        pushSimulatedChat(kw, `Viewer${suffix}`);
        break;
      }
      case "toggle-live": {
        const app = useAppStore.getState();
        const nextLive = !app.stats.live;
        app.setStats({
          live: nextLive,
          viewers: nextLive ? Math.max(app.stats.viewers ?? 0, 25) : 0,
          startedAt: nextLive ? new Date().toISOString() : undefined,
        });
        toast.info(`Stream simulated: ${nextLive ? "LIVE" : "OFFLINE"}`);
        break;
      }
      case "bump-stats": {
        const app = useAppStore.getState();
        app.setStats({
          viewers: Math.max(0, (app.stats.viewers ?? 0) + (cmd.viewers ?? 0)),
          followers: Math.max(0, (app.stats.followers ?? 0) + (cmd.followers ?? 0)),
        });
        break;
      }
      case "set-connection": {
        const app = useAppStore.getState();
        const nextState = {
          phase: cmd.phase,
          account: cmd.phase === "connected" ? "dev_account" : undefined,
          detail: cmd.phase === "error" ? "DevTools simulated error" : undefined,
        };
        if (cmd.target === "twitch") app.setTwitch(nextState);
        else if (cmd.target === "twitchBot") app.setTwitchBot(nextState);
        else if (cmd.target === "obs") app.setObs(nextState);
        else if (cmd.target === "streamElements") app.setStreamElements(nextState);
        else if (cmd.target === "tipeeStream") app.setTipeeeStream(nextState);
        break;
      }
      case "reload":
        window.location.reload();
        break;
    }
  };

  broadcastState();

  return () => {
    window.clearTimeout(timer);
    unsubApp();
    unsubNet();
    unsubCrash();
    channel.close();
  };
}
