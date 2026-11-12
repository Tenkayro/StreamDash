import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityEvent,
  AppSettings,
  ChatMessage,
  CloudSyncRemoteMeta,
  ProEntitlements,
  ProfileExportBundle,
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
export async function saveLocalState(key: string, value: unknown) {
  if (isTauri()) await invoke("setting_save", { key, value });
  else {
    const existing = await loadSettings();
    localStorage.setItem(
      "streamdash-settings",
      JSON.stringify({ ...existing, [key]: value }),
    );
  }
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
  const existing = await loadSettings();
  localStorage.setItem(
    "streamdash-settings",
    JSON.stringify({ ...existing, ...entries }),
  );
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
};
