import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { errorMessage, isTauri, money } from "../lib/utils";
import {
  loadEvents,
  loadSettings,
  saveEvent,
  saveSetting,
  secretDelete,
  secretGet,
  secretSet,
  twitchNative,
} from "./native";
import {
  loadTwitchSnapshot,
  needsTwitchPermissionUpdate,
  TwitchEventSub,
  TWITCH_SCOPES,
} from "./twitch/client";
import { TWITCH_CLIENT_ID } from "./twitch/config";
import { TwitchChatClient } from "./twitch/chat";
import { StreamElementsClient } from "./streamelements/client";
import { TipeeeStreamClient } from "./tipeeestream/client";
import { DEFAULT_OBS_ADDRESS, ObsClient } from "./obs/client";
import type { ActivityEvent, AppSettings, ChatUserProfile } from "../types";
import { RuntimeContext, type DeviceAuth } from "./runtime-context";
import i18n from "../i18n";

type Bootstrap = {
  settings: Partial<AppSettings>;
  events: ActivityEvent[];
};

let bootstrapPromise: Promise<Bootstrap> | undefined;

function loadBootstrap() {
  bootstrapPromise ??= (async () => {
    const settings = await loadSettings();
    if (typeof settings.onboardingCompleted !== "boolean") {
      settings.onboardingCompleted = Object.keys(settings).length > 0;
      await saveSetting("onboardingCompleted", settings.onboardingCompleted);
    }
    if ((settings.dashboardLayoutVersion ?? 0) < 3) {
      if (
        Array.isArray(settings.dashboardWidgets) &&
        settings.dashboardWidgets.includes("livePreview")
      ) {
        settings.dashboardWidgets = settings.dashboardWidgets.filter(
          (widget) => widget !== "livePreview",
        );
        await saveSetting("dashboardWidgets", settings.dashboardWidgets);
      }
      settings.dashboardLayoutVersion = 3;
      await saveSetting("dashboardLayoutVersion", 3);
    }
    const events = await loadEvents(settings.maximumEvents ?? 5000);
    return { settings, events };
  })().catch((error) => {
    bootstrapPromise = undefined;
    throw error;
  });
  return bootstrapPromise;
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const setSettings = useAppStore((s) => s.setSettings);
  const setEvents = useAppStore((s) => s.setEvents);
  const setReady = useAppStore((s) => s.setReady);
  const state = useAppStore.getState;
  const twitchRef = useRef<TwitchEventSub | undefined>(undefined);
  const seRef = useRef<StreamElementsClient | undefined>(undefined);
  const tipeeStreamRef = useRef<TipeeeStreamClient | undefined>(undefined);
  const obsRef = useRef<ObsClient | undefined>(undefined);
  const chatRef = useRef<TwitchChatClient | undefined>(undefined);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuth>();

  const ingest = useCallback(
    async (event: ActivityEvent) => {
      const current = state();
      if (current.settings.disabledEventTypes.includes(event.eventType)) return;
      if (!(await saveEvent(event, current.settings.maximumEvents))) return;
      current.pushEvent(event);
      if (event.bits)
        current.setStats({ bits: current.stats.bits + event.bits });
      if (event.amount)
        current.setStats({
          donations: current.stats.donations + event.amount,
          donationCurrency: event.currency,
        });
      if (event.eventType === "stream_online")
        current.setStats({ live: true, startedAt: event.timestamp });
      if (event.eventType === "stream_offline")
        current.setStats({ live: false, viewers: 0, startedAt: undefined });
      const notify =
        current.settings.notifications &&
        ((event.eventType === "donation" && current.settings.notifyDonations) ||
          (event.eventType === "raid" && current.settings.notifyRaids) ||
          (["gift_subscription", "community_gift"].includes(event.eventType) &&
            current.settings.notifyGiftSubs));
      if (notify && isTauri()) {
        let allowed = await isPermissionGranted();
        if (!allowed) allowed = (await requestPermission()) === "granted";
        if (allowed)
          sendNotification({
            title:
              event.eventType === "donation"
                ? `${i18n.t("events.donation")} · ${money(event.amount ?? 0, event.currency)}`
                : i18n.t(`events.${event.eventType}`),
            body: `${event.displayName || event.username || i18n.t("runtime.someone")}${event.message ? ` — ${event.message}` : ""}`,
          });
      }
    },
    [state],
  );

  const startTwitch = useCallback(async () => {
    if (!isTauri()) {
      state().setStatsLoading(false);
      chatRef.current?.stop();
      state().setChat({ phase: "disconnected" });
      state().setTwitch({ phase: "disconnected" });
      return;
    }
    state().setStatsLoading(true);
    try {
      const session = await twitchNative.session(TWITCH_CLIENT_ID);
      if (!session) {
        state().setStatsLoading(false);
        chatRef.current?.stop();
        state().setChat({ phase: "disconnected" });
        state().setTwitch({ phase: "disconnected" });
        return;
      }
      if (needsTwitchPermissionUpdate(session.scopes))
        toast.warning(i18n.t("runtime.permissionsAttention"), {
          id: "twitch-permissions",
          description:
            i18n.t("runtime.permissionsDetail"),
          action: {
            label: i18n.t("chat.openConnections"),
            onClick: () => state().setPage("connections"),
          },
          duration: 12_000,
        });
      else toast.dismiss("twitch-permissions");
      twitchRef.current?.stop();
      state().setTwitch({
        phase: "connecting",
        account: session.login,
        userId: session.userId,
        scopes: session.scopes,
      });
      try {
        state().setStats(await loadTwitchSnapshot(TWITCH_CLIENT_ID, session));
      } catch (error) {
        toast.error(i18n.t("runtime.statsUnavailable"), {
          description: errorMessage(error),
        });
      } finally {
        state().setStatsLoading(false);
      }
      twitchRef.current = new TwitchEventSub(
        TWITCH_CLIENT_ID,
        session,
        ingest,
        (phase, detail) =>
          state().setTwitch({
            phase,
            account: session.login,
            userId: session.userId,
            scopes: session.scopes,
            detail,
          }),
      );
      twitchRef.current.start();
      chatRef.current?.stop();
      chatRef.current = new TwitchChatClient(
        TWITCH_CLIENT_ID,
        session.login,
        session.userId,
        (message) => state().pushChatMessage(message),
        (phase, detail) => state().setChat({ phase, detail }),
        (id) => state().removeChatMessage(id),
        (login) => state().clearChat(login),
        (emotes) => state().setChatEmotes(emotes),
      );
      chatRef.current.start();
    } catch (error) {
      state().setStatsLoading(false);
      chatRef.current?.stop();
      state().setChat({ phase: "error", detail: errorMessage(error) });
      state().setTwitch({ phase: "expired", detail: errorMessage(error) });
    }
  }, [ingest, state]);

  const startStreamElements = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const token = await secretGet("streamelements-token");
      if (!token) {
        state().setStreamElements({ phase: "disconnected" });
        return;
      }
      seRef.current?.stop();
      state().setStreamElements({ phase: "connecting" });
      seRef.current = new StreamElementsClient(token, ingest, (phase, detail) =>
        state().setStreamElements({ phase, detail }),
      );
      seRef.current.start();
    } catch (error) {
      state().setStreamElements({
        phase: "error",
        detail: errorMessage(error),
      });
    }
  }, [ingest, state]);

  const startTipeeeStream = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const apiKey = await secretGet("tipeeestream-api-key");
      if (!apiKey) {
        state().setTipeeeStream({ phase: "disconnected" });
        return;
      }
      tipeeStreamRef.current?.stop();
      state().setTipeeeStream({ phase: "connecting" });
      tipeeStreamRef.current = new TipeeeStreamClient(
        apiKey,
        ingest,
        (phase, detail) => state().setTipeeeStream({ phase, detail }),
        (key, options) => i18n.t(key, options),
      );
      await tipeeStreamRef.current.start();
    } catch (error) {
      state().setTipeeeStream({ phase: "error", detail: errorMessage(error) });
    }
  }, [ingest, state]);

  const startObs = useCallback(async () => {
    if (!isTauri()) return;
    const current = state();
    if (!current.settings.obsEnabled) {
      current.setObs({ phase: "disconnected" });
      current.setObsSnapshot(undefined);
      return;
    }
    try {
      const password = await secretGet("obs-password").catch(() => null);
      if (!state().settings.obsEnabled) return;
      obsRef.current?.stop();
      current.setObs({ phase: "connecting" });
      const client = new ObsClient({
        address: state().settings.obsAddress || DEFAULT_OBS_ADDRESS,
        password: password ?? undefined,
        translate: (key) => i18n.t(key),
        onSnapshot: (snapshot) => state().setObsSnapshot(snapshot),
        onState: (phase, detail) => state().setObs({ phase, detail }),
      });
      obsRef.current = client;
      client.start();
    } catch (error) {
      current.setObs({ phase: "error", detail: errorMessage(error) });
    }
  }, [state]);

  const reconnect = useCallback(async () => {
    await Promise.all([
      startTwitch(),
      startStreamElements(),
      startTipeeeStream(),
      startObs(),
    ]);
  }, [startTwitch, startStreamElements, startTipeeeStream, startObs]);

  const shutdown = useCallback(async () => {
    twitchRef.current?.stop();
    twitchRef.current = undefined;
    seRef.current?.stop();
    seRef.current = undefined;
    tipeeStreamRef.current?.stop();
    tipeeStreamRef.current = undefined;
    obsRef.current?.stop();
    obsRef.current = undefined;
    chatRef.current?.stop();
    chatRef.current = undefined;
    if (isTauri()) await twitchNative.chatStop().catch(() => undefined);
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    (async () => {
      try {
        const { settings, events } = await loadBootstrap();
        if (disposed) return;
        setSettings(settings);
        setEvents(events);
        const bits = events.reduce((n, e) => n + (e.bits ?? 0), 0);
        const donations = events.reduce((n, e) => n + (e.amount ?? 0), 0);
        state().setStats({
          bits,
          donations,
          donationCurrency: events.find((e) => e.currency)?.currency,
        });
        setReady(true);
        await reconnect();
      } catch (error) {
        toast.error(i18n.t("runtime.initializeError"), {
          description: errorMessage(error),
        });
        setReady(true);
      }
      if (isTauri()) {
        unlisten.push(
          await listen("tray-reconnect", reconnect),
          await listen<string>("tray-navigate", (event) =>
            state().setPage(event.payload),
          ),
        );
      }
    })();
    return () => {
      disposed = true;
      unlisten.forEach((f) => f());
      twitchRef.current?.stop();
      seRef.current?.stop();
      tipeeStreamRef.current?.stop();
      obsRef.current?.stop();
      chatRef.current?.stop();
    };
  }, [reconnect, setEvents, setReady, setSettings, state]);

  const connectTwitch = async () => {
    try {
      state().setTwitch({
        phase: "connecting",
        detail: i18n.t("runtime.waitingAuthorization"),
      });
      const device = await twitchNative.deviceStart(
        TWITCH_CLIENT_ID,
        TWITCH_SCOPES,
      );
      setDeviceAuth({
        code: device.user_code,
        url: device.verification_uri,
        expiresAt: Date.now() + device.expires_in * 1000,
      });
      await openUrl(device.verification_uri);
      let interval = Math.max(device.interval, 1) * 1000;
      const expiresAt = Date.now() + device.expires_in * 1000;
      while (Date.now() < expiresAt) {
        await new Promise((r) => setTimeout(r, interval));
        const result = await twitchNative.devicePoll(
          TWITCH_CLIENT_ID,
          device.device_code,
          TWITCH_SCOPES,
        );
        if (result.status === "authorized") {
          setDeviceAuth(undefined);
          toast.success(i18n.t("runtime.twitchConnected"));
          await startTwitch();
          return;
        }
        if (result.status === "slow_down") interval += 5000;
      }
      throw new Error(i18n.t("runtime.codeExpired"));
    } catch (error) {
      setDeviceAuth(undefined);
      state().setTwitch({ phase: "error", detail: errorMessage(error) });
      toast.error(i18n.t("runtime.connectError"), {
        description: errorMessage(error),
      });
    }
  };
  const disconnectTwitch = async () => {
    twitchRef.current?.stop();
    chatRef.current?.stop();
    state().setChat({ phase: "disconnected" });
    state().setChatEmotes([]);
    await secretDelete("twitch-oauth");
    state().setTwitch({ phase: "disconnected" });
    state().setStatsLoading(false);
    state().setStats({
      followers: undefined,
      subscribers: undefined,
      viewers: undefined,
      live: false,
      startedAt: undefined,
    });
  };
  const reauthorizeTwitch = async () => {
    await disconnectTwitch();
    await connectTwitch();
  };
  const connectStreamElements = async (token: string) => {
    if (!token.trim()) return;
    await secretSet("streamelements-token", token.trim());
    await startStreamElements();
  };
  const disconnectStreamElements = async () => {
    seRef.current?.stop();
    seRef.current = undefined;
    await secretDelete("streamelements-token");
    state().setStreamElements({ phase: "disconnected" });
  };
  const connectTipeeeStream = async (apiKey: string) => {
    if (!apiKey.trim()) return;
    await secretSet("tipeeestream-api-key", apiKey.trim());
    await startTipeeeStream();
  };
  const disconnectTipeeeStream = async () => {
    tipeeStreamRef.current?.stop();
    tipeeStreamRef.current = undefined;
    state().setTipeeeStream({ phase: "disconnected" });
    await secretDelete("tipeeestream-api-key").catch(() => undefined);
  };
  const connectObs = async (address: string, password: string) => {
    const value = address.trim() || DEFAULT_OBS_ADDRESS;
    state().setSettings({ obsAddress: value, obsEnabled: true });
    await saveSetting("obsAddress", value);
    await saveSetting("obsEnabled", true);
    if (password.trim()) await secretSet("obs-password", password.trim());
    await startObs();
  };
  const disconnectObs = async () => {
    obsRef.current?.stop();
    obsRef.current = undefined;
    state().setObs({ phase: "disconnected" });
    state().setObsSnapshot(undefined);
    state().setSettings({ obsEnabled: false });
    await saveSetting("obsEnabled", false).catch(() => undefined);
  };
  const obsAction = async (action: (client: ObsClient) => Promise<void>) => {
    const client = obsRef.current;
    if (!client) return;
    try {
      await action(client);
    } catch (error) {
      toast.error(i18n.t("obs.errors.action"), {
        description: errorMessage(error),
      });
    }
  };
  const setObsScene = (scene: string) =>
    obsAction((client) => client.setScene(scene));
  const setObsMute = (input: string, muted: boolean) =>
    obsAction((client) => client.setMute(input, muted));
  const setObsVolume = (input: string, volume: number) =>
    obsAction((client) => client.setVolume(input, volume));
  const setObsStreaming = (active: boolean) =>
    obsAction((client) => client.setStreaming(active));
  const setObsRecording = (active: boolean) =>
    obsAction((client) => client.setRecording(active));
  const setObsRecordingPaused = (paused: boolean) =>
    obsAction((client) => client.setRecordingPaused(paused));
  const setObsReplayBuffer = (active: boolean) =>
    obsAction((client) => client.setReplayBuffer(active));
  const saveObsReplayBuffer = () =>
    obsAction((client) => client.saveReplayBuffer());
  const setObsVirtualCam = (active: boolean) =>
    obsAction((client) => client.setVirtualCam(active));
  const sendChatMessage = async (text: string) => {    const message = text.trim();
    const userId = state().twitch.userId;
    if (!message) return;
    if (!userId) throw new Error(i18n.t("stream.notConnected"));
    try {
      await twitchNative.chatSend(state().twitch.account ?? "", message);
      chatRef.current?.echo(message);
      return;
    } catch {
      /* fall back to Helix when the chat socket is down */
    }
    const result = await twitchNative.helixPost<{
      data?: Array<{ is_sent?: boolean; drop_reason?: { message?: string } }>;
    }>(TWITCH_CLIENT_ID, "chat/messages", [], {
      broadcaster_id: userId,
      sender_id: userId,
      message,
    });
    const dropped = result.data?.find((entry) => entry.is_sent === false);
    if (dropped)
      throw new Error(
        dropped.drop_reason?.message ?? "Twitch rejected the message",
      );
  };

  const moderationContext = (scope: string) => {
    const current = state();
    const broadcasterId = current.twitch.userId;
    if (!broadcasterId) throw new Error(i18n.t("stream.notConnected"));
    if (!current.twitch.scopes?.includes(scope))
      throw new Error(
        i18n.t("runtime.moderationPermission"),
      );
    return { clientId: TWITCH_CLIENT_ID, broadcasterId };
  };
  const getChatUserProfile = async (
    login: string,
  ): Promise<ChatUserProfile> => {
    const current = state();
    const broadcasterId = current.twitch.userId;
    if (!broadcasterId) throw new Error(i18n.t("stream.notConnected"));
    const clientId = TWITCH_CLIENT_ID;
    const users = await twitchNative.helix<{
      data?: Array<{
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
        created_at?: string;
      }>;
    }>(clientId, "users", [["login", login]]);
    const user = users.data?.[0];
    if (!user) throw new Error(i18n.t("runtime.userNotFound"));
    const [follow, ban, moderator, vip] = await Promise.allSettled([
      twitchNative.helix<{ data?: Array<{ followed_at?: string }> }>(
        clientId,
        "channels/followers",
        [
          ["broadcaster_id", broadcasterId],
          ["user_id", user.id],
        ],
      ),
      current.twitch.scopes?.includes("moderator:manage:banned_users")
        ? twitchNative.helix<{
            data?: Array<{ expires_at?: string; reason?: string }>;
          }>(clientId, "moderation/banned", [
            ["broadcaster_id", broadcasterId],
            ["user_id", user.id],
          ])
        : Promise.resolve({ data: [] }),
      current.twitch.scopes?.includes("channel:manage:moderators")
        ? twitchNative.helix<{ data?: unknown[] }>(
            clientId,
            "moderation/moderators",
            [
              ["broadcaster_id", broadcasterId],
              ["user_id", user.id],
            ],
          )
        : Promise.resolve({ data: [] }),
      current.twitch.scopes?.includes("channel:manage:vips")
        ? twitchNative.helix<{ data?: unknown[] }>(clientId, "channels/vips", [
            ["broadcaster_id", broadcasterId],
            ["user_id", user.id],
          ])
        : Promise.resolve({ data: [] }),
    ]);
    const follower =
      follow.status === "fulfilled" ? follow.value.data?.[0] : undefined;
    const banned = ban.status === "fulfilled" ? ban.value.data?.[0] : undefined;
    return {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      avatarUrl: user.profile_image_url,
      createdAt: user.created_at,
      followedAt: follower?.followed_at,
      banned: Boolean(banned),
      bannedUntil: banned?.expires_at,
      banReason: banned?.reason,
      moderator:
        moderator.status === "fulfilled" &&
        Boolean(moderator.value.data?.length),
      vip: vip.status === "fulfilled" && Boolean(vip.value.data?.length),
    };
  };
  const moderateChatUser = async (
    userId: string,
    duration?: number,
    reason?: string,
  ) => {
    const { clientId, broadcasterId } = moderationContext(
      "moderator:manage:banned_users",
    );
    const data: Record<string, unknown> = { user_id: userId };
    if (duration != null)
      data.duration = Math.max(1, Math.min(1_209_600, Math.round(duration)));
    if (reason?.trim()) data.reason = reason.trim().slice(0, 500);
    await twitchNative.helixPost(
      clientId,
      "moderation/bans",
      [
        ["broadcaster_id", broadcasterId],
        ["moderator_id", broadcasterId],
      ],
      { data },
    );
  };
  const unbanChatUser = async (userId: string) => {
    const { clientId, broadcasterId } = moderationContext(
      "moderator:manage:banned_users",
    );
    await twitchNative.helixDelete(clientId, "moderation/bans", [
      ["broadcaster_id", broadcasterId],
      ["moderator_id", broadcasterId],
      ["user_id", userId],
    ]);
  };
  const deleteChatMessage = async (messageId: string) => {
    const { clientId, broadcasterId } = moderationContext(
      "moderator:manage:chat_messages",
    );
    await twitchNative.helixDelete(clientId, "moderation/chat", [
      ["broadcaster_id", broadcasterId],
      ["moderator_id", broadcasterId],
      ["message_id", messageId],
    ]);
    state().removeChatMessage(messageId);
  };
  const setChatUserRole = async (
    userId: string,
    role: "moderator" | "vip",
    enabled: boolean,
  ) => {
    const scope =
      role === "moderator"
        ? "channel:manage:moderators"
        : "channel:manage:vips";
    const { clientId, broadcasterId } = moderationContext(scope);
    const path =
      role === "moderator" ? "moderation/moderators" : "channels/vips";
    const query: [string, string][] = [
      ["broadcaster_id", broadcasterId],
      ["user_id", userId],
    ];
    if (enabled) await twitchNative.helixPost(clientId, path, query, {});
    else await twitchNative.helixDelete(clientId, path, query);
  };

  return (
    <RuntimeContext.Provider
      value={{
        deviceAuth,
        connectTwitch,
        disconnectTwitch,
        reauthorizeTwitch,
        connectStreamElements,
        retryStreamElements: startStreamElements,
        disconnectStreamElements,
        connectTipeeeStream,
        retryTipeeeStream: startTipeeeStream,
        disconnectTipeeeStream,
        connectObs,
        retryObs: startObs,
        disconnectObs,
        setObsScene,
        setObsMute,
        setObsVolume,
        setObsStreaming,
        setObsRecording,
        setObsRecordingPaused,
        setObsReplayBuffer,
        saveObsReplayBuffer,
        setObsVirtualCam,
        sendChatMessage,
        getChatUserProfile,
        moderateChatUser,
        unbanChatUser,
        deleteChatMessage,
        setChatUserRole,
        reconnect,
        shutdown,
      }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}
