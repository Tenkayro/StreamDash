import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityEvent,
  AppSettings,
  ChatMessage,
  CloudSyncRemoteMeta,
  DashboardStats,
  ProEntitlements,
  ProfileExportBundle,
  StorageQuotaInfo,
  StorageQuotaTicket,
  StorageTicketState,
  SupportResetTicket,
  SupportTicketState,
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

export type CloudSyncPullResult =
  | { exists: false; proRequired?: boolean }
  | { meta: CloudSyncRemoteMeta; bundle: ProfileExportBundle };

export type CloudSyncPushResult =
  | { ok: true; unchanged?: boolean; meta: CloudSyncRemoteMeta }
  | { ok: false; proRequired: true }
  | {
      ok: false;
      conflict: true;
      meta: CloudSyncRemoteMeta;
      bundle?: ProfileExportBundle;
    };

export const cloudSyncNative = {
  meta: (clientId: string): Promise<CloudSyncRemoteMeta> =>
    isTauri()
      ? invoke<CloudSyncRemoteMeta>("cloud_sync_meta", { clientId })
      : Promise.resolve({ exists: false }),
  pull: (clientId: string): Promise<CloudSyncPullResult> =>
    isTauri()
      ? invoke<CloudSyncPullResult>("cloud_sync_pull", { clientId })
      : Promise.resolve({ exists: false }),
  push: (
    clientId: string,
    params: {
      bundle: ProfileExportBundle;
      updatedAt?: number;
      expectedRevision?: number;
      force?: boolean;
    },
  ): Promise<CloudSyncPushResult> =>
    isTauri()
      ? invoke<CloudSyncPushResult>("cloud_sync_push", {
          clientId,
          bundle: params.bundle,
          updatedAt: params.updatedAt,
          expectedRevision: params.expectedRevision,
          force: params.force,
        })
      : Promise.reject(new Error("Cloud sync requires the desktop app")),
  remove: (clientId: string): Promise<{ ok: boolean; deleted: boolean }> =>
    isTauri()
      ? invoke<{ ok: boolean; deleted: boolean }>("cloud_sync_delete", { clientId })
      : Promise.resolve({ ok: true, deleted: false }),
};

export const proNative = {
  entitlements: (clientId: string): Promise<ProEntitlements> =>
    isTauri()
      ? invoke<ProEntitlements>("pro_entitlements", { clientId })
      : Promise.resolve({ tier: "free", pro: false, features: [] }),
  activate: (
    clientId: string,
    licenseKey: string,
  ): Promise<{ ok: boolean; alreadyActivated?: boolean; entitlements: ProEntitlements }> =>
    isTauri()
      ? invoke<{ ok: boolean; alreadyActivated?: boolean; entitlements: ProEntitlements }>(
          "pro_activate_license",
          { clientId, licenseKey },
        )
      : Promise.reject(new Error("Pro activation requires the desktop app")),
};

export const supportNative = {
  ticketStatus: (clientId: string): Promise<SupportTicketState> =>
    isTauri()
      ? invoke<SupportTicketState>("support_ticket_status", { clientId })
      : Promise.resolve({
          hasActiveLicense: false,
          resetsUsed: 0,
          maxResets: 1,
          resetsRemaining: 0,
          canSubmit: false,
          blockedReason: "no_active_license",
        }),
  submitKeyReset: (
    clientId: string,
    message: string,
  ): Promise<{ ok: boolean; ticket: SupportResetTicket }> =>
    isTauri()
      ? invoke<{ ok: boolean; ticket: SupportResetTicket }>("support_submit_key_reset", {
          clientId,
          message,
        })
      : Promise.reject(new Error("Support tickets require the desktop app")),
  storageStatus: (clientId: string): Promise<StorageTicketState> =>
    isTauri()
      ? invoke<StorageTicketState>("support_storage_status", { clientId })
      : Promise.reject(new Error("Storage status requires the desktop app")),
  submitStorageRequest: (
    clientId: string,
    requestedMb: number,
    message: string,
  ): Promise<{ ok: boolean; ticket: StorageQuotaTicket; storage: StorageQuotaInfo }> =>
    isTauri()
      ? invoke<{ ok: boolean; ticket: StorageQuotaTicket; storage: StorageQuotaInfo }>(
          "support_storage_request",
          {
            clientId,
            requestedMb,
            message,
          },
        )
      : Promise.reject(new Error("Storage requests require the desktop app")),
};

export interface CloudHistoryPayload {
  version: number;
  exportedAt: number;
  events: ActivityEvent[];
  stats: DashboardStats;
}

export interface CloudHistoryMetaResponse {
  exists: boolean;
  revision: number;
  payloadSha256?: string;
  rawBytes?: number;
  compressedBytes?: number;
  eventCount?: number;
  updatedAt?: number;
  storage?: StorageQuotaInfo;
}

export interface CloudHistoryPullResponse {
  exists: boolean;
  revision: number;
  payloadSha256?: string;
  rawBytes?: number;
  compressedBytes?: number;
  eventCount?: number;
  updatedAt?: number;
  payload?: CloudHistoryPayload;
  storage?: StorageQuotaInfo;
}

export interface CloudHistoryPushResponse {
  ok: boolean;
  revision: number;
  payloadSha256: string;
  rawBytes: number;
  compressedBytes: number;
  eventCount: number;
  updatedAt: number;
  storage?: StorageQuotaInfo;
}

export const historySyncNative = {
  meta: (clientId: string): Promise<CloudHistoryMetaResponse> =>
    isTauri()
      ? invoke<CloudHistoryMetaResponse>("history_sync_meta", { clientId })
      : Promise.resolve({ exists: false, revision: 0 }),
  pull: (clientId: string): Promise<CloudHistoryPullResponse> =>
    isTauri()
      ? invoke<CloudHistoryPullResponse>("history_sync_pull", { clientId })
      : Promise.resolve({ exists: false, revision: 0 }),
  push: (
    clientId: string,
    params: {
      payload: CloudHistoryPayload;
      expectedRevision?: number;
    },
  ): Promise<CloudHistoryPushResponse> =>
    isTauri()
      ? invoke<CloudHistoryPushResponse>("history_sync_push", {
          clientId,
          payload: params.payload,
          expectedRevision: params.expectedRevision,
        })
      : Promise.reject(new Error("Cloud history sync requires the desktop app")),
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
};
