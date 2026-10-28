import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, AppSettings, TwitchSession } from "../types";
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
export async function loadSettings(): Promise<Partial<AppSettings>> {
  return isTauri()
    ? invoke("settings_load")
    : JSON.parse(localStorage.getItem("streamdash-settings") || "{}");
}
export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
) {
  if (isTauri()) await invoke("setting_save", { key, value });
  else {
    const existing = await loadSettings();
    localStorage.setItem(
      "streamdash-settings",
      JSON.stringify({ ...existing, [key]: value }),
    );
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
  name: IntegrationSecret | "twitch-oauth",
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
  devicePoll: (clientId: string, deviceCode: string, scopes: string[]) =>
    invoke<{ status: string }>("twitch_device_poll", {
      clientId,
      deviceCode,
      scopes,
    }),
  session: (clientId: string) =>
    invoke<TwitchSession | null>("twitch_session", { clientId }),
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
  ) => invoke<T>("twitch_helix_post", { clientId, path, query, body }),
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
  chatSend: (channel: string, message: string) =>
    invoke("twitch_chat_send", { channel, message }),
  chatStop: () => invoke("twitch_chat_stop"),
  subscribe: (clientId: string, body: unknown) =>
    invoke("twitch_eventsub_create", { clientId, body }),
};
