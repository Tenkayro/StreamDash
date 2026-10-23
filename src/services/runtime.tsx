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
import { TwitchChatClient } from "./twitch/chat";
import { StreamElementsClient } from "./streamelements/client";
import type { ActivityEvent, AppSettings, ChatUserProfile } from "../types";
import { RuntimeContext, type DeviceAuth } from "./runtime-context";

type Bootstrap = {
  settings: Partial<AppSettings>;
  events: ActivityEvent[];
};

let bootstrapPromise: Promise<Bootstrap> | undefined;

function loadBootstrap() {
  bootstrapPromise ??= (async () => {
    const settings = await loadSettings();
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
                ? `Donation · ${money(event.amount ?? 0, event.currency)}`
                : event.eventType.replaceAll("_", " "),
            body: `${event.displayName || event.username || "Someone"}${event.message ? ` — ${event.message}` : ""}`,
          });
      }
    },
    [state],
  );

  const startTwitch = useCallback(async () => {
    const clientId = state().settings.twitchClientId.trim();
    if (!clientId || !isTauri()) {
      chatRef.current?.stop();
      state().setChat({ phase: "disconnected" });
      state().setTwitch({
        phase: "disconnected",
        detail: clientId ? undefined : "Client ID not configured",
      });
      return;
    }
    try {
      const session = await twitchNative.session(clientId);
      if (!session) {
        chatRef.current?.stop();
        state().setChat({ phase: "disconnected" });
        state().setTwitch({ phase: "disconnected" });
        return;
      }
      if (needsTwitchPermissionUpdate(session.scopes))
        toast.warning("Twitch permissions need attention", {
          id: "twitch-permissions",
          description:
            "Reconnect Twitch once to enable all moderation and channel features.",
          action: {
            label: "Open Connections",
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
        state().setStats(await loadTwitchSnapshot(clientId, session));
      } catch (error) {
        toast.error("Some Twitch statistics are unavailable", {
          description: errorMessage(error),
        });
      }
      twitchRef.current = new TwitchEventSub(
        clientId,
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
        clientId,
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

  const reconnect = useCallback(async () => {
    await Promise.all([startTwitch(), startStreamElements()]);
  }, [startTwitch, startStreamElements]);

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
        toast.error("StreamDash could not initialize", {
          description: errorMessage(error),
        });
        setReady(true);
      }
      if (isTauri()) {
        unlisten.push(
          await listen("tray-reconnect", reconnect),
          await listen("tray-settings", () => state().setPage("settings")),
        );
      }
    })();
    return () => {
      disposed = true;
      unlisten.forEach((f) => f());
      twitchRef.current?.stop();
      seRef.current?.stop();
      chatRef.current?.stop();
    };
  }, [reconnect, setEvents, setReady, setSettings, state]);

  const connectTwitch = async () => {
    const clientId = state().settings.twitchClientId.trim();
    if (!clientId) {
      state().setPage("settings");
      toast.error("Twitch Client ID is not configured", {
        description: "Add it under Settings → Twitch.",
      });
      return;
    }
    try {
      state().setTwitch({
        phase: "connecting",
        detail: "Waiting for authorization",
      });
      const device = await twitchNative.deviceStart(clientId, TWITCH_SCOPES);
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
          clientId,
          device.device_code,
          TWITCH_SCOPES,
        );
        if (result.status === "authorized") {
          setDeviceAuth(undefined);
          toast.success("Twitch connected");
          await startTwitch();
          return;
        }
        if (result.status === "slow_down") interval += 5000;
      }
      throw new Error("The Twitch authorization code expired");
    } catch (error) {
      setDeviceAuth(undefined);
      state().setTwitch({ phase: "error", detail: errorMessage(error) });
      toast.error("Could not connect Twitch", {
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
    await secretDelete("streamelements-token");
    state().setStreamElements({ phase: "disconnected" });
  };
  const sendChatMessage = async (text: string) => {
    const message = text.trim();
    const clientId = state().settings.twitchClientId.trim();
    const userId = state().twitch.userId;
    if (!message) return;
    if (!clientId || !userId) throw new Error("Twitch is not connected");
    try {
      await twitchNative.chatSend(state().twitch.account ?? "", message);
      chatRef.current?.echo(message);
      return;
    } catch {
      /* fall back to Helix when the chat socket is down */
    }
    const result = await twitchNative.helixPost<{
      data?: Array<{ is_sent?: boolean; drop_reason?: { message?: string } }>;
    }>(clientId, "chat/messages", [], {
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
    const clientId = current.settings.twitchClientId.trim();
    const broadcasterId = current.twitch.userId;
    if (!clientId || !broadcasterId) throw new Error("Twitch is not connected");
    if (!current.twitch.scopes?.includes(scope))
      throw new Error(
        "Reconnect Twitch once to grant the required moderation permission",
      );
    return { clientId, broadcasterId };
  };
  const getChatUserProfile = async (
    login: string,
  ): Promise<ChatUserProfile> => {
    const current = state();
    const clientId = current.settings.twitchClientId.trim();
    const broadcasterId = current.twitch.userId;
    if (!clientId || !broadcasterId) throw new Error("Twitch is not connected");
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
    if (!user) throw new Error("Twitch user was not found");
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
        disconnectStreamElements,
        sendChatMessage,
        getChatUserProfile,
        moderateChatUser,
        unbanChatUser,
        deleteChatMessage,
        setChatUserRole,
        reconnect,
      }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}
