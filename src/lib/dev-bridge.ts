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
      eventType: "follow" | "subscription" | "raid" | "cheer" | "donation";
    }
  | { type: "simulate-chat" }
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

function pushSimulatedEvent(
  eventType: "follow" | "subscription" | "raid" | "cheer" | "donation",
) {
  const now = new Date().toISOString();
  const id = `dev-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const samples: Record<typeof eventType, ActivityEvent> = {
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
    donation: {
      id,
      source: "streamelements",
      eventType: "donation",
      username: "dev_donor",
      displayName: "DevDonor",
      amount: 10,
      currency: "EUR",
      message: "DevTools test tip!",
      timestamp: now,
      metadata: { devSimulated: true },
    },
  };

  useAppStore.getState().pushEvent(samples[eventType]);
  toast.success(`Simulated ${eventType} event pushed`);
}

function pushSimulatedChat() {
  const msg: ChatMessage = {
    id: `dev-chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    login: "devtools_user",
    displayName: "DevToolsUser",
    color: "#9147ff",
    badges: [],
    timestamp: Date.now(),
    text: "Hello from StreamDash DevTools! This is a simulated chat message.",
    parts: [
      {
        type: "text",
        text: "Hello from StreamDash DevTools! This is a simulated chat message.",
      },
    ],
  };
  useAppStore.getState().pushChatMessage(msg);
  toast.info("Simulated chat message added");
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
        pushSimulatedChat();
        break;
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
