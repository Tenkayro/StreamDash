import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityEvent,
  AppSettings,
  ChatMessage,
  TwitchSession,
} from "../types";
import { isTauri } from "../lib/utils";

export async function loadEvents(limit = 5000): Promise<ActivityEvent[]> {
  return isTauri() ? invoke("events_list", { limit }) : [];
}
export async function saveEvent(
  event: ActivityEvent,
  maxEvents: number,
): Promise<boolean> {
  return isTauri() ? invoke("event_insert", { event, maxEvents }) : true;
}
export async function clearEvents() {
  if (isTauri()) await invoke("events_clear");
  else await postRemoteAction("events.clear");
}
export async function mergeEvents(
  events: ActivityEvent[],
  maxEvents = 50_000,
): Promise<number> {
  return isTauri() ? invoke("history_merge_events", { events, maxEvents }) : 0;
}
export async function loadChatMessages(limit = 1000): Promise<ChatMessage[]> {
  return isTauri() ? invoke("chat_messages_list", { limit }) : [];
}
export async function saveChatMessage(
  message: ChatMessage,
  maxMessages: number,
): Promise<boolean> {
  return isTauri() ? invoke("chat_message_insert", { message, maxMessages }) : true;
}
export async function updateChatMessage(opts: { id?: string; login?: string; deleted: boolean }) {
  if (isTauri()) await invoke("chat_message_update", opts);
}
export async function clearChatMessages() {
  if (isTauri()) await invoke("chat_messages_clear");
  else await postRemoteAction("chat.clear");
}
export async function loadSettings(): Promise<Record<string, unknown>> {
  return isTauri()
    ? invoke("settings_load")
    : JSON.parse(localStorage.getItem("streamdash-settings") || "{}");
}
export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
) {
  await saveLocalState(key, value);
}
async function postRemoteAction(type: string, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const token = sessionStorage.getItem("sd_remote_token") ?? "";
  await fetch("/api/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-SD-Token": token } : {}),
    },
    body: JSON.stringify({ type, payload }),
  }).catch(() => undefined);
}

export async function saveLocalState(key: string, value: unknown) {
  if (isTauri()) await invoke("setting_save", { key, value });
  else await postRemoteAction("state.save", { key, value });
}
export async function saveLocalStateBatch(entries: Record<string, unknown>) {
  if (!Object.keys(entries).length) return;
  if (isTauri()) {
    try {
      await invoke("settings_save_batch", { entries });
      return;
    } catch {
      for (const [key, value] of Object.entries(entries)) {
        await saveLocalState(key, value);
      }
      return;
    }
  }
  await postRemoteAction("state.saveBatch", { entries });
}
export async function importHistoryBatch(
  events: ActivityEvent[],
  chatMessages: ChatMessage[],
  maxEvents = 5000,
  maxChatMessages = 1000,
) {
  if (!isTauri() || (!events.length && !chatMessages.length)) return;
  try {
    await invoke("history_import", {
      events,
      chatMessages,
      maxEvents,
      maxChatMessages,
    });
  } catch {
    for (const event of events.slice(0, maxEvents)) {
      await saveEvent(event, maxEvents);
    }
    for (const message of chatMessages.slice(-maxChatMessages)) {
      await saveChatMessage(message, maxChatMessages);
    }
  }
}
export interface SpotifyOverlayInfo { url: string; width: number; height: number }
export interface SpotifyNowPlaying {
  available: boolean;
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  hasCover: boolean;
  revision: number;
}
export const spotifyOverlayNative = {
  info: () => invoke<SpotifyOverlayInfo>("spotify_overlay_info"),
  status: () => invoke<SpotifyNowPlaying>("spotify_overlay_status"),
};
type IntegrationSecret =
  | "streamelements-token"
  | "tipeeestream-api-key"
  | "obs-password";
export async function secretSet(name: IntegrationSecret, value: string) {
  return invoke("secret_set", { name, value });
}
export async function secretGet(name: IntegrationSecret): Promise<string | null> {
  return invoke("secret_get", { name });
}
export async function secretDelete(
  name: IntegrationSecret | "twitch-oauth" | "twitch-bot-oauth",
) {
  return invoke("secret_delete", { name });
}

export const twitchNative = {
  deviceStart: (clientId: string, scopes: string[]) =>
    invoke<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    }>("twitch_device_start", { clientId, scopes }),
  devicePoll: (
    clientId: string,
    deviceCode: string,
    scopes: string[],
    bot = false,
  ) =>
    invoke<{ status: string }>("twitch_device_poll", {
      clientId,
      deviceCode,
      scopes,
      bot,
    }),
  session: (clientId: string, bot = false) =>
    invoke<TwitchSession | null>("twitch_session", { clientId, bot }),
  helix: <T>(clientId: string, path: string, query: [string, string][] = []) =>
    invoke<T>("twitch_helix_get", { clientId, path, query }),
  helixPatch: <T>(
    clientId: string,
    path: string,
    query: [string, string][],
    body: Record<string, unknown>,
  ) => invoke<T>("twitch_helix_patch", { clientId, path, query, body }),
  helixPost: <T>(
    clientId: string,
    path: string,
    query: [string, string][],
    body: Record<string, unknown>,
    bot = false,
  ) => invoke<T>("twitch_helix_post", { clientId, path, query, body, bot }),
  helixPut: <T>(
    clientId: string,
    path: string,
    query: [string, string][],
    body: Record<string, unknown>,
  ) => invoke<T>("twitch_helix_put", { clientId, path, query, body }),
  helixDelete: <T>(clientId: string, path: string, query: [string, string][]) =>
    invoke<T>("twitch_helix_delete", { clientId, path, query }),
  chatStart: (
    clientId: string,
    login: string,
    channel: string,
    session: string,
  ) => invoke("twitch_chat_start", { clientId, login, channel, session }),
  chatSend: (channel: string, message: string, replyParentId?: string) =>
    invoke("twitch_chat_send", { channel, message, replyParentId }),
  chatStop: () => invoke("twitch_chat_stop"),
  subscribe: (clientId: string, body: unknown) =>
    invoke("twitch_eventsub_create", { clientId, body }),
};

export interface WebHostStatus {
  enabled: boolean;
  running: boolean;
  headless: boolean;
  port: number;
  requireAuth: boolean;
  token: string;
  localIps: string[];
  urls: string[];
  connectedClients: number;
  lastError?: string | null;
}

export interface WebHostPairRequest {
  requestId: string;
  verifyCode: string;
  deviceName: string;
  expiresInSec: number;
}

export const webHostNative = {
  status: async (): Promise<WebHostStatus> => {
    if (isTauri()) return invoke<WebHostStatus>("web_host_status");
    const token = typeof window !== "undefined" ? sessionStorage.getItem("sd_remote_token") ?? "" : "";
    const res = await fetch(`/api/host-status${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    if (res.ok) return (await res.json()) as WebHostStatus;
    return {
      enabled: false,
      running: false,
      headless: false,
      port: 48950,
      requireAuth: true,
      token: "",
      localIps: ["127.0.0.1"],
      urls: [],
      connectedClients: 0,
    };
  },
  configure: (params: {
    enabled: boolean;
    port: number;
    requireAuth: boolean;
    token?: string;
  }): Promise<WebHostStatus> =>
    isTauri()
      ? invoke<WebHostStatus>("web_host_configure", params)
      : Promise.reject(new Error("Web host requires the desktop app")),
  regenerateToken: (): Promise<WebHostStatus> =>
    isTauri()
      ? invoke<WebHostStatus>("web_host_regenerate_token")
      : Promise.reject(new Error("Web host requires the desktop app")),
  publishState: (snapshot: unknown): Promise<void> =>
    isTauri()
      ? invoke<void>("web_host_publish_state", { snapshot })
      : Promise.resolve(),
  publishCompanionEvent: (event: unknown): Promise<void> =>
    isTauri()
      ? invoke<void>("web_host_publish_companion_event", { event })
      : Promise.resolve(),
  pendingPairRequests: (): Promise<WebHostPairRequest[]> =>
    isTauri()
      ? invoke<WebHostPairRequest[]>("web_host_pair_pending")
      : Promise.resolve([]),
  respondPairRequest: (requestId: string, approve: boolean): Promise<boolean> =>
    isTauri()
      ? invoke<boolean>("web_host_pair_respond", { requestId, approve })
      : Promise.resolve(false),
};
