import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  disable as disableAutostart,
  enable as enableAutostart,
} from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";
import { defaultSettings } from "../lib/defaults";
import { useAppStore } from "../stores/app-store";
import { errorMessage, isTauri, money } from "../lib/utils";
import {
  bootstrapProfiles,
  buildPersistenceBatch,
  cloneJson,
  createCleanSnapshot,
  createExportBundle,
  createProfileId,
  extractSnapshotFromState,
  mergeSnapshotSections,
  normalizeProfileSnapshot,
  resolveProfileForTwitchAccount,
  saveJsonFile,
} from "../lib/profiles";
import {
  importHistoryBatch,
  loadChatMessages,
  loadEvents,
  loadSettings,
  saveChatMessage,
  saveEvent,
  saveLocalState,
  saveLocalStateBatch,
  saveSetting,
  secretDelete,
  secretGet,
  secretSet,
  spotifyOverlayNative,
  twitchNative,
  webHostNative,
} from "./native";
import {
  loadTwitchSnapshot,
  loadTwitchStreamStatus,
  needsTwitchPermissionUpdate,
  TwitchEventSub,
  TWITCH_BOT_SCOPES,
  TWITCH_SCOPES,
} from "./twitch/client";
import { TWITCH_CLIENT_ID } from "./twitch/config";
import { TwitchChatClient } from "./twitch/chat";
import { StreamElementsClient } from "./streamelements/client";
import { TipeeeStreamClient } from "./tipeeestream/client";
import { DEFAULT_OBS_ADDRESS, ObsClient } from "./obs/client";
import type {
  ActivityEvent,
  AppSettings,
  ChannelPointReward,
  ChatAlertsConfig,
  ChatCommand,
  ChatMessage,
  ChatUserProfile,
  CommandRole,
  CustomVariable,
  DashboardStats,
  GiveawayState,
  GoalMetric,
  ProfileConfigSnapshot,
  ProfileExportBundle,
  TwitchSession,
  UserProfile,
} from "../types";
import {
  RuntimeContext,
  type CreateProfileOptions,
  type DeviceAuth,
  type ExportProfileOptions,
  type ImportProfileOptions,
  type RuntimeValue,
} from "./runtime-context";
import i18n, { resolveLanguage } from "../i18n";
import { resolveVariables } from "../lib/variables";

type Bootstrap = {
  settings: Partial<AppSettings>;
  giveaway?: Partial<GiveawayState>;
  cachedStats?: Partial<DashboardStats>;
  commands?: ChatCommand[];
  channelRewards?: ChannelPointReward[];
  chatAlerts?: Partial<ChatAlertsConfig>;
  customVariables?: CustomVariable[];
  rawProfiles?: unknown;
  rawActiveProfileId?: unknown;
  rawLastTwitchUserId?: unknown;
  rawProfilesAutoSwitch?: unknown;
  events: ActivityEvent[];
  chatMessages: ChatMessage[];
};

const REMOTE_IGNORED_STATE_KEYS = new Set([
  "page",
  "pageHistory",
  "pageHistoryIndex",
  "searchTarget",
  "unreadCounts",
]);

const REMOTE_BLOCKED_METHODS = new Set([
  "shutdown",
  "deviceAuth",
  "botDeviceAuth",
  "connectTwitch",
  "disconnectTwitch",
  "reauthorizeTwitch",
  "connectTwitchBot",
  "disconnectTwitchBot",
  "reauthorizeTwitchBot",
  "exportProfiles",
  "importProfiles",
]);

function serializeHostSnapshot(storeState: ReturnType<typeof useAppStore.getState>) {
  const out: Record<string, unknown> = { ready: true };
  for (const [key, val] of Object.entries(storeState)) {
    if (typeof val === "function" || REMOTE_IGNORED_STATE_KEYS.has(key)) continue;
    if (key === "chatMessages" && Array.isArray(val)) {
      out[key] = val.slice(-100);
    } else if (key === "events" && Array.isArray(val)) {
      out[key] = val.slice(0, 200);
    } else {
      out[key] = val;
    }
  }
  return out;
}

const REMOTE_LOCAL_METHODS = new Set([
  "getChatUserProfile",
  "exportProfiles",
  "importProfiles",
]);

const noopAsync = async () => undefined;

function createStableRuntimeProxy(
  dataProps: { deviceAuth?: DeviceAuth; botDeviceAuth?: DeviceAuth },
  getMethods: () => Record<string, unknown>,
  getDispatch: () => (
    actionType: string,
    payload?: Record<string, unknown>,
  ) => Promise<void>,
  remoteMode: boolean,
): RuntimeValue {
  const fnCache = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(dataProps as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop === "then" || prop === "$$typeof") {
        return Reflect.get(target, prop, receiver);
      }
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      let cached = fnCache.get(prop);
      if (!cached) {
        if (remoteMode && !REMOTE_LOCAL_METHODS.has(prop)) {
          cached = REMOTE_BLOCKED_METHODS.has(prop)
            ? noopAsync
            : (...args: unknown[]) =>
                getDispatch()("runtime.call", { method: prop, args });
        } else {
          cached = (...args: unknown[]) => {
            const fn = getMethods()[prop];
            if (typeof fn !== "function") {
              return Promise.resolve(undefined);
            }
            return (fn as (...a: unknown[]) => unknown)(...args);
          };
        }
        fnCache.set(prop, cached);
      }
      return cached;
    },
  }) as unknown as RuntimeValue;
}

let bootstrapPromise: Promise<Bootstrap> | undefined;

function loadBootstrap() {
  bootstrapPromise ??= (async () => {
    const raw = await loadSettings();
    const {
      giveaway,
      cachedStats,
      commands,
      channelRewards,
      chatAlerts,
      customVariables,
      profiles: rawProfiles,
      activeProfileId: rawActiveProfileId,
      lastTwitchUserId: rawLastTwitchUserId,
      profilesAutoSwitch: rawProfilesAutoSwitch,
      ...restSettings
    } = raw as Partial<AppSettings> & {
      giveaway?: Partial<GiveawayState>;
      cachedStats?: Partial<DashboardStats>;
      commands?: ChatCommand[];
      channelRewards?: ChannelPointReward[];
      chatAlerts?: Partial<ChatAlertsConfig>;
      customVariables?: CustomVariable[];
      profiles?: unknown;
      activeProfileId?: unknown;
      lastTwitchUserId?: unknown;
      profilesAutoSwitch?: unknown;
    };
    const settings: Partial<AppSettings> = {
      ...restSettings,
      ...(restSettings.companion && typeof restSettings.companion === "object"
        ? {
            companion: {
              ...defaultSettings.companion,
              ...restSettings.companion,
            },
          }
        : {}),
    };
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
    const [events, chatMessages] = await Promise.all([
      loadEvents(settings.maximumEvents ?? 5000),
      loadChatMessages(settings.maximumChatMessages ?? 1000),
    ]);
    return {
      settings,
      giveaway,
      cachedStats,
      commands,
      channelRewards,
      chatAlerts,
      customVariables,
      rawProfiles,
      rawActiveProfileId,
      rawLastTwitchUserId,
      rawProfilesAutoSwitch,
      events,
      chatMessages,
    };
  })().catch((error) => {
    bootstrapPromise = undefined;
    throw error;
  });
  return bootstrapPromise;
}

const SONG_VARIABLE_PATTERN = /\$\((?:spotify\.)?song\)|\{song\}/i;

async function resolveTemplateWithSong(
  rawTemplate: string,
  ctx: Omit<Parameters<typeof resolveVariables>[1], "songText">,
): Promise<string> {
  let songText: string | undefined;
  if (SONG_VARIABLE_PATTERN.test(rawTemplate)) {
    try {
      const song = await spotifyOverlayNative.status();
      if (song.available && song.title) {
        songText = song.artist ? `${song.artist} — ${song.title}` : song.title;
      }
    } catch {
      /* ignore spotify error */
    }
  }
  return resolveVariables(rawTemplate, { ...ctx, songText });
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const setSettings = useAppStore((s) => s.setSettings);
  const setEvents = useAppStore((s) => s.setEvents);
  const setChatMessages = useAppStore((s) => s.setChatMessages);
  const setReady = useAppStore((s) => s.setReady);
  const twitchPhase = useAppStore((s) => s.twitch.phase);
  const twitchUserId = useAppStore((s) => s.twitch.userId);
  const state = useAppStore.getState;
  const twitchRef = useRef<TwitchEventSub | undefined>(undefined);
  const seRef = useRef<StreamElementsClient | undefined>(undefined);
  const tipeeStreamRef = useRef<TipeeeStreamClient | undefined>(undefined);
  const obsRef = useRef<ObsClient | undefined>(undefined);
  const chatRef = useRef<TwitchChatClient | undefined>(undefined);
  const commandGlobalCooldownsRef = useRef(new Map<string, number>());
  const commandUserCooldownsRef = useRef(new Map<string, number>());
  const twitchAuthAttemptRef = useRef(0);
  const botAuthAttemptRef = useRef(0);
  const applyingProfileRef = useRef(false);
  const [deviceAuth, setDeviceAuth] = useState<DeviceAuth>();
  const [botDeviceAuth, setBotDeviceAuth] = useState<DeviceAuth>();
  const ready = useAppStore((s) => s.ready);
  const stats = useAppStore((s) => s.stats);
  const events = useAppStore((s) => s.events);
  const settings = useAppStore((s) => s.settings);
  const commands = useAppStore((s) => s.commands);
  const chatAlerts = useAppStore((s) => s.chatAlerts);
  const customVariables = useAppStore((s) => s.customVariables);
  const channelRewards = useAppStore((s) => s.channelRewards);
  const giveaway = useAppStore((s) => s.giveaway);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const goals = useAppStore((s) => s.settings.goals);
  const goalAutomation = useAppStore((s) => s.settings.goalAutomation);
  const giveawayRunning = useAppStore((s) => s.giveaway.running);
  const giveawayTimeout = useAppStore((s) => s.giveaway.inactivityTimeout);

  const buildSyncedProfiles = useCallback(() => {
    const current = state();
    const snapshot = extractSnapshotFromState(current);
    const now = Date.now();
    const exists = current.profiles.some((p) => p.id === current.activeProfileId);
    const nextProfiles = exists
      ? current.profiles.map((p) =>
          p.id === current.activeProfileId
            ? { ...p, data: cloneJson(snapshot), updatedAt: now }
            : p,
        )
      : [
          {
            id: current.activeProfileId || "default",
            name: i18n.t("profiles.defaultName"),
            createdAt: now,
            updatedAt: now,
            data: cloneJson(snapshot),
          },
          ...current.profiles,
        ];
    return { nextProfiles, snapshot };
  }, [state]);

  useEffect(() => {
    if (!ready || applyingProfileRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingProfileRef.current) return;
      const { nextProfiles } = buildSyncedProfiles();
      state().setProfiles(nextProfiles);
      void saveLocalState("profiles", nextProfiles).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    ready,
    settings,
    commands,
    chatAlerts,
    customVariables,
    channelRewards,
    giveaway,
    activeProfileId,
    buildSyncedProfiles,
    state,
  ]);

  useEffect(() => {
    if (!giveawayRunning || giveawayTimeout <= 0) return;
    const timer = window.setInterval(() => {
      state().pruneInactiveGiveawayEntries();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [giveawayRunning, giveawayTimeout, state]);

  useEffect(() => {
    if (!ready) return;
    const values: Record<GoalMetric, number | undefined> = {
      followers: stats.followers,
      subscribers: stats.subscribers,
      donations: stats.donations,
      bits: stats.bits,
      raids: events.filter((event) => event.eventType === "raid").length,
      giftSubscriptions: events.reduce(
        (total, event) =>
          total +
          (event.eventType === "community_gift"
            ? (event.giftCount ?? 1)
            : event.eventType === "gift_subscription"
              ? 1
              : 0),
        0,
      ),
    };
    const nextGoals = { ...goals };
    let changed = false;
    (Object.keys(values) as GoalMetric[]).forEach((metric) => {
      const target = goals[metric];
      const value = values[metric];
      const automation = goalAutomation[metric];
      if (!automation?.enabled || !target || value == null || value < target)
        return;
      const percent = Math.min(100, Math.max(5, automation.increasePercent || 20));
      const rawTarget = Math.max(target, value) * (1 + percent / 100);
      nextGoals[metric] =
        metric === "donations"
          ? Math.max(target + 0.01, Math.ceil(rawTarget * 100) / 100)
          : Math.max(target + 1, Math.ceil(rawTarget));
      changed = true;
    });
    if (!changed) return;
    setSettings({ goals: nextGoals });
    void saveSetting("goals", nextGoals).catch(() => {
      if (state().settings.goals === nextGoals) setSettings({ goals });
      toast.error(i18n.t("goals.saveError"));
    });
  }, [events, goalAutomation, goals, ready, setSettings, state, stats.bits, stats.donations, stats.followers, stats.subscribers]);

  useEffect(() => {
    if (twitchPhase !== "connected" || !twitchUserId) return;
    const scopes = state().twitch.scopes ?? [];
    if (!scopes.includes("channel:manage:redemptions")) return;
    const rewards = state().channelRewards;
    for (const reward of rewards) {
      if (!reward.manageable || !reward.enabled) continue;
      const shouldBeActive = stats.live
        ? reward.enabledWhenOnline
        : reward.enabledWhenOffline;
      const shouldPause = !shouldBeActive;
      if (reward.paused === shouldPause) continue;
      void twitchNative
        .helixPatch(
          TWITCH_CLIENT_ID,
          "channel_points/custom_rewards",
          [
            ["broadcaster_id", twitchUserId],
            ["id", reward.id],
          ],
          { is_paused: shouldPause },
        )
        .then(() => {
          state().upsertChannelReward({ ...reward, paused: shouldPause });
        })
        .catch(() => undefined);
    }
  }, [ state, stats.live, twitchPhase, twitchUserId ]);

  const sendChat = useCallback(async (text: string, replyParentId?: string) => {
    const message = text.trim();
    const userId = state().twitch.userId;
    if (!message) return;
    if (!userId) throw new Error(i18n.t("stream.notConnected"));
    try {
      await twitchNative.chatSend(state().twitch.account ?? "", message, replyParentId);
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
      ...(replyParentId ? { reply_parent_message_id: replyParentId } : {}),
    });
    const dropped = result.data?.find((entry) => entry.is_sent === false);
    if (dropped) throw new Error(dropped.drop_reason?.message ?? "Twitch rejected the message");
    chatRef.current?.echo(message);
  }, [state]);

  const sendCommandReply = useCallback(
    async (text: string, replyParentId?: string) => {
      const message = text.trim();
      const current = state();
      const broadcasterId = current.twitch.userId;
      const botId = current.twitchBot.userId;
      if (!message) return;
      if (!broadcasterId) throw new Error(i18n.t("stream.notConnected"));
      if (current.twitchBot.phase === "connected" && botId) {
        const result = await twitchNative.helixPost<{
          data?: Array<{ is_sent?: boolean; drop_reason?: { message?: string } }>;
        }>(
          TWITCH_CLIENT_ID,
          "chat/messages",
          [],
          {
            broadcaster_id: broadcasterId,
            sender_id: botId,
            message,
            ...(replyParentId ? { reply_parent_message_id: replyParentId } : {}),
          },
          true,
        );
        const dropped = result.data?.find((entry) => entry.is_sent === false);
        if (dropped) {
          throw new Error(
            dropped.drop_reason?.message ?? "Twitch rejected the message",
          );
        }
        chatRef.current?.echo(message, current.twitchBot.account);
        return;
      }
      await sendChat(message, replyParentId);
    },
    [sendChat, state],
  );

  useEffect(() => {
    if (twitchPhase !== "connected" || !twitchUserId) return;
    let disposed = false;
    let refreshing = false;
    let initialized = false;
    let prevCategory = state().stats.category;
    let prevTitle = state().stats.title;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const snapshot = await loadTwitchStreamStatus(TWITCH_CLIENT_ID, twitchUserId);
        if (disposed) return;
        const current = state();
        const channelName = current.twitch.account || "";
        if (initialized) {
          if (
            snapshot.category &&
            prevCategory &&
            snapshot.category !== prevCategory &&
            current.chatAlerts.gameChange.enabled
          ) {
            const msg = resolveVariables(
              current.chatAlerts.gameChange.message,
              {
                state: current,
                user: channelName,
                alertData: {
                  game: snapshot.category,
                  title: snapshot.title ?? prevTitle ?? "",
                },
              },
            ).trim();
            if (msg) void sendCommandReply(msg.slice(0, 480)).catch(() => undefined);
          }
          if (
            snapshot.title &&
            prevTitle &&
            snapshot.title !== prevTitle &&
            current.chatAlerts.titleChange.enabled
          ) {
            const msg = resolveVariables(
              current.chatAlerts.titleChange.message,
              {
                state: current,
                user: channelName,
                alertData: {
                  game: snapshot.category ?? prevCategory ?? "",
                  title: snapshot.title,
                },
              },
            ).trim();
            if (msg) void sendCommandReply(msg.slice(0, 480)).catch(() => undefined);
          }
        }
        if (snapshot.category) prevCategory = snapshot.category;
        if (snapshot.title) prevTitle = snapshot.title;
        initialized = true;
        current.setStats(snapshot);
      } catch {
        /* EventSub remains the primary source; the poll is a consistency check. */
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [sendCommandReply, state, twitchPhase, twitchUserId]);

  const ingest = useCallback(
    async (event: ActivityEvent) => {
      const current = state();
      if (current.settings.disabledEventTypes.includes(event.eventType)) return;
      if (!(await saveEvent(event, current.settings.maximumEvents))) return;
      current.pushEvent(event);
      if (event.eventType === "follow" && current.stats.followers != null) {
        current.setStats({ followers: current.stats.followers + 1 });
      }
      if (
        (event.eventType === "subscription" ||
          event.eventType === "gift_subscription") &&
        current.stats.subscribers != null
      ) {
        current.setStats({ subscribers: current.stats.subscribers + 1 });
      }
      if (
        event.eventType === "community_gift" &&
        current.stats.subscribers != null
      ) {
        current.setStats({
          subscribers: current.stats.subscribers + (event.giftCount ?? 1),
        });
      }
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

      const alerts = current.chatAlerts;
      const user = event.displayName || event.username || i18n.t("runtime.someone");
      const gameName = current.stats.category || "";
      const streamTitle = current.stats.title || "";
      const months = Number(event.metadata?.months ?? 1);
      const isPrime = Boolean(event.metadata?.isPrime);
      const recipient = String(event.metadata?.recipient ?? "");
      const tier = event.tier;

      let alertTemplate: string | undefined;
      if (event.eventType === "subscription") {
        if (isPrime && alerts.subPrime.enabled) alertTemplate = alerts.subPrime.message;
        else if (tier === "3000" && alerts.subTier3.enabled) alertTemplate = alerts.subTier3.message;
        else if (tier === "2000" && alerts.subTier2.enabled) alertTemplate = alerts.subTier2.message;
        else if (alerts.subTier1.enabled) alertTemplate = alerts.subTier1.message;
      } else if (event.eventType === "resubscription") {
        if (isPrime && alerts.resubPrime.enabled) alertTemplate = alerts.resubPrime.message;
        else if (tier === "3000" && alerts.resubTier3.enabled) alertTemplate = alerts.resubTier3.message;
        else if (tier === "2000" && alerts.resubTier2.enabled) alertTemplate = alerts.resubTier2.message;
        else if (alerts.resubTier1.enabled) alertTemplate = alerts.resubTier1.message;
      } else if (event.eventType === "gift_subscription") {
        if (tier === "3000" && alerts.giftTier3.enabled) alertTemplate = alerts.giftTier3.message;
        else if (tier === "2000" && alerts.giftTier2.enabled) alertTemplate = alerts.giftTier2.message;
        else if (alerts.giftTier1.enabled) alertTemplate = alerts.giftTier1.message;
      } else if (event.eventType === "community_gift") {
        if (tier === "3000" && alerts.massGiftTier3.enabled) alertTemplate = alerts.massGiftTier3.message;
        else if (tier === "2000" && alerts.massGiftTier2.enabled) alertTemplate = alerts.massGiftTier2.message;
        else if (alerts.massGiftTier1.enabled) alertTemplate = alerts.massGiftTier1.message;
      } else if (
        event.eventType === "raid" &&
        alerts.raid.enabled &&
        (event.viewerCount ?? 0) >= alerts.raid.minimum
      ) {
        alertTemplate = alerts.raid.message;
      } else if (
        event.eventType === "cheer" &&
        alerts.bits.enabled &&
        (event.bits ?? 0) >= alerts.bits.minimum
      ) {
        alertTemplate = alerts.bits.message;
      } else if (
        event.eventType === "donation" &&
        alerts.donation?.enabled &&
        (event.amount ?? 0) >= (alerts.donation.minimum ?? 0)
      ) {
        alertTemplate = alerts.donation.message;
      } else if (event.eventType === "follow" && alerts.follower.enabled) {
        alertTemplate = alerts.follower.message;
      } else if (
        event.eventType === "channel_point" &&
        alerts.channelPoint?.enabled
      ) {
        alertTemplate = alerts.channelPoint.message;
      } else if (event.eventType === "stream_online" && alerts.goLive.enabled) {
        alertTemplate = alerts.goLive.message;
      } else if (
        event.eventType === "stream_offline" &&
        alerts.goOffline?.enabled
      ) {
        alertTemplate = alerts.goOffline.message;
      }

      if (alertTemplate && current.twitch.phase === "connected") {
        const tierLabel = isPrime
          ? "Prime Gaming"
          : tier === "3000"
            ? "Tier 3"
            : tier === "2000"
              ? "Tier 2"
              : "Tier 1";
        const rewardTitle =
          typeof event.metadata?.rewardTitle === "string"
            ? event.metadata.rewardTitle
            : undefined;
        const formatted = resolveVariables(alertTemplate, {
          state: state(),
          user,
          userLogin: event.username || user,
          alertData: {
            months,
            recipient: recipient || user,
            amount:
              event.eventType === "donation"
                ? money(event.amount ?? 0, event.currency)
                : (event.giftCount ?? event.amount ?? 1),
            bits: event.bits ?? 0,
            viewers: event.viewerCount,
            tier: tierLabel,
            game: gameName,
            title:
              event.eventType === "channel_point"
                ? rewardTitle || event.message || streamTitle
                : streamTitle,
          },
        }).trim();
        if (formatted) {
          void sendCommandReply(formatted.slice(0, 480)).catch(() => undefined);
        }
      }
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
      if (isTauri()) {
        void webHostNative
          .publishCompanionEvent({
            kind: "activity",
            id: event.id,
            eventType: event.eventType,
            displayName: event.displayName || event.username || "",
            amount: event.amount,
            currency: event.currency,
            bits: event.bits,
            giftCount: event.giftCount,
            viewerCount: event.viewerCount,
            tier: event.tier,
            message: event.message,
            timestamp: event.timestamp,
          })
          .catch(() => undefined);
      }
    },
    [sendCommandReply, state],
  );

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

  const applySnapshotAndPersist = useCallback(
    async (
      rawSnapshot: ProfileConfigSnapshot,
      meta: {
        profiles: UserProfile[];
        activeProfileId: string;
        lastTwitchUserId?: string;
        profilesAutoSwitch?: boolean;
      },
      options?: { preserveLiveStats?: boolean },
    ) => {
      const current = state();
      const prevSettings = current.settings;
      const snapshot = normalizeProfileSnapshot(rawSnapshot);
      applyingProfileRef.current = true;
      try {
        current.setProfiles(meta.profiles);
        current.setActiveProfileId(meta.activeProfileId);
        if (meta.lastTwitchUserId !== undefined) {
          current.setLastTwitchUserId(meta.lastTwitchUserId);
        }
        if (meta.profilesAutoSwitch !== undefined) {
          current.setProfilesAutoSwitch(meta.profilesAutoSwitch);
        }
        current.setSettings(snapshot.settings);
        current.setCommands(snapshot.commands);
        current.setChatAlerts(snapshot.chatAlerts);
        current.setCustomVariables(snapshot.customVariables);
        current.setChannelRewards(snapshot.channelRewards);
        current.setGiveaway(snapshot.giveaway);
        if (!options?.preserveLiveStats && current.twitch.phase !== "connected") {
          current.setStats({
            ...snapshot.cachedStats,
            live: false,
          });
        }
        if (
          isTauri() &&
          snapshot.settings.launchAtStartup !== prevSettings.launchAtStartup
        ) {
          await (snapshot.settings.launchAtStartup
            ? enableAutostart()
            : disableAutostart()
          ).catch(() => undefined);
        }
        await saveLocalStateBatch(buildPersistenceBatch(snapshot, meta));
      } finally {
        window.setTimeout(() => {
          applyingProfileRef.current = false;
        }, 0);
      }
      if (
        snapshot.settings.obsEnabled !== prevSettings.obsEnabled ||
        snapshot.settings.obsAddress !== prevSettings.obsAddress
      ) {
        void startObs();
      }
    },
    [startObs, state],
  );

  const applyTwitchAccountProfile = useCallback(
    async (session: TwitchSession) => {
      const current = state();
      if (!current.profiles.length) return;
      const currentSnapshot = extractSnapshotFromState(current);
      const resolved = resolveProfileForTwitchAccount({
        session,
        profiles: current.profiles,
        activeProfileId: current.activeProfileId,
        lastTwitchUserId: current.lastTwitchUserId,
        profilesAutoSwitch: current.profilesAutoSwitch,
        currentSnapshot,
      });
      if (resolved.appliedProfile) {
        await applySnapshotAndPersist(
          resolved.appliedProfile.data,
          {
            profiles: resolved.profiles,
            activeProfileId: resolved.activeProfileId,
            lastTwitchUserId: resolved.lastTwitchUserId,
          },
          { preserveLiveStats: true },
        );
        if (resolved.reason === "switched") {
          toast.info(
            i18n.t("profiles.switchedForAccount", {
              name: resolved.appliedProfile.name,
              account: session.login,
            }),
          );
        } else if (resolved.reason === "created") {
          toast.info(
            i18n.t("profiles.createdForAccount", {
              account: session.login,
            }),
          );
        }
        return;
      }
      current.setProfiles(resolved.profiles);
      current.setActiveProfileId(resolved.activeProfileId);
      current.setLastTwitchUserId(resolved.lastTwitchUserId);
      await saveLocalStateBatch({
        profiles: resolved.profiles,
        activeProfileId: resolved.activeProfileId,
        lastTwitchUserId: resolved.lastTwitchUserId,
      }).catch(() => undefined);
    },
    [applySnapshotAndPersist, state],
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
      await applyTwitchAccountProfile(session);
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
        (message) => {
          void saveChatMessage(message, state().settings.maximumChatMessages).catch(() => undefined);
          state().pushChatMessage(message);
          state().ingestGiveawayChatMessage(message, state().twitchBot.account);
          if (message.deleted) return;
          const current = state();
          const botAccount = current.twitchBot.account?.toLowerCase();
          if (botAccount && message.login.toLowerCase() === botAccount) return;
          const rawText = message.text.trim();
          if (!rawText) return;
          const lowerText = rawText.toLowerCase();
          const firstToken = lowerText.split(/\s+/)[0] ?? "";
          const now = Date.now();
          const isLive = current.stats.live;
          const currentCategory = (current.stats.category ?? "").toLowerCase();
          const currentTitle = (current.stats.title ?? "").toLowerCase();
          if (isTauri()) {
            const broadcasterLogin = (current.twitch.account ?? session.login).toLowerCase();
            if (message.login.toLowerCase() !== broadcasterLogin) {
              const highlightWords = current.settings.chatHighlightWords ?? [];
              const mentioned =
                lowerText.includes(`@${broadcasterLogin}`) ||
                lowerText.split(/[\s,.:;!?]+/).includes(broadcasterLogin) ||
                highlightWords.some((w) => {
                  const trimmed = w.trim().toLowerCase();
                  return trimmed.length > 0 && lowerText.includes(trimmed);
                });
              if (mentioned) {
                void webHostNative
                  .publishCompanionEvent({
                    kind: "chat_mention",
                    id: message.id,
                    eventType: "chat_mention",
                    displayName: message.displayName || message.login,
                    message: rawText,
                    timestamp: new Date(message.timestamp).toISOString(),
                  })
                  .catch(() => undefined);
              }
            }
          }
          const userRoles = new Set<CommandRole>();
          const badgeIds = new Set(message.badges.map((b) => b.id.toLowerCase()));
          if (
            badgeIds.has("broadcaster") ||
            (current.twitch.account &&
              message.login.toLowerCase() === current.twitch.account.toLowerCase())
          ) {
            userRoles.add("broadcaster");
            userRoles.add("moderator");
          }
          if (badgeIds.has("moderator")) userRoles.add("moderator");
          if (badgeIds.has("vip")) userRoles.add("vip");
          if (badgeIds.has("founder")) {
            userRoles.add("founder");
            userRoles.add("subscriber");
          }
          if (badgeIds.has("subscriber")) userRoles.add("subscriber");
          if (!userRoles.has("subscriber") && !userRoles.has("founder")) {
            userRoles.add("non_subscriber");
          }

          for (const cmd of current.commands) {
            if (!cmd.enabled) continue;
            if (cmd.expiryAction !== "none" && cmd.expiresAt && now >= cmd.expiresAt) {
              if (cmd.expiryAction === "delete" && !cmd.builtIn) {
                current.deleteCommand(cmd.id);
              } else {
                current.toggleCommand(cmd.id, false);
              }
              continue;
            }
            if (isLive ? !cmd.enabledWhenOnline : !cmd.enabledWhenOffline) continue;
            if (
              cmd.games.length > 0 &&
              !cmd.games.some((g) => g.trim().toLowerCase() === currentCategory)
            ) {
              continue;
            }
            if (
              cmd.titleKeywords.length > 0 &&
              !cmd.titleKeywords.some((kw) =>
                currentTitle.includes(kw.trim().toLowerCase()),
              )
            ) {
              continue;
            }
            if (
              cmd.roles.length > 0 &&
              !cmd.roles.some((role) => userRoles.has(role))
            ) {
              continue;
            }

            const cleanName = cmd.name.trim().replace(/^!+/, "").toLowerCase();
            if (!cleanName) continue;
            const primaryTrigger = cmd.usePrefix ? `!${cleanName}` : cleanName;
            const matchesTrigger = firstToken === primaryTrigger;
            const matchesAlias = cmd.aliases.some((alias) => {
              const cleanAlias = alias.trim().replace(/^!+/, "").toLowerCase();
              if (!cleanAlias) return false;
              const aliasTrigger = cmd.usePrefix ? `!${cleanAlias}` : cleanAlias;
              return firstToken === aliasTrigger || firstToken === alias.trim().toLowerCase();
            });
            const matchesKeyword = cmd.keywords.some((kw) => {
              const cleanKw = kw.trim().toLowerCase();
              return Boolean(cleanKw) && lowerText.includes(cleanKw);
            });

            if (!matchesTrigger && !matchesAlias && !matchesKeyword) continue;

            const lastGlobal = commandGlobalCooldownsRef.current.get(cmd.id) ?? 0;
            const userKey = `${cmd.id}:${message.login.toLowerCase()}`;
            const lastUser = commandUserCooldownsRef.current.get(userKey) ?? 0;
            const globalWait = cmd.globalCooldown * 1000 - (now - lastGlobal);
            const userWait = cmd.perUserCooldown * 1000 - (now - lastUser);
            if (globalWait > 0 || userWait > 0) {
              if (cmd.whisperOnCooldown) {
                const remaining = Math.max(
                  1,
                  Math.ceil(Math.max(globalWait, userWait) / 1000),
                );
                const lng = resolveLanguage(current.settings.language);
                const user = message.displayName || message.login;
                const notice = i18n.t("commands.cooldownNotice", {
                  lng,
                  user,
                  command: primaryTrigger,
                  seconds: remaining,
                });
                void sendCommandReply(notice.slice(0, 480), message.id).catch(
                  () => undefined,
                );
              }
              continue;
            }

            commandGlobalCooldownsRef.current.set(cmd.id, now);
            commandUserCooldownsRef.current.set(userKey, now);
            const usageCount = current.incrementCommandUsage(cmd.id);

            const dispatchResponse = async (rawResponse: string) => {
              const user = message.displayName || message.login;
              const interpolated = (
                await resolveTemplateWithSong(rawResponse, {
                  state: state(),
                  user,
                  userLogin: message.login,
                  rawMessageText: rawText,
                  commandCount: usageCount,
                })
              ).trim();
              if (!interpolated) return;
              if (cmd.responseType === "mention") {
                const text = interpolated.startsWith(`@${user}`)
                  ? interpolated
                  : `@${user} ${interpolated}`;
                await sendCommandReply(text.slice(0, 480));
                return;
              }
              if (cmd.responseType === "reply" || cmd.responseType === "whisper") {
                await sendCommandReply(interpolated.slice(0, 480), message.id);
                return;
              }
              await sendCommandReply(interpolated.slice(0, 480));
            };

            if (cmd.builtIn && cmd.id === "builtin-song") {
              void spotifyOverlayNative
                .status()
                .then(
                  (song) => {
                    const lng = resolveLanguage(state().settings.language);
                    const user = message.displayName || message.login;
                    return song.available && song.title
                      ? i18n.t("runtime.songCommandCurrent", {
                          lng,
                          user,
                          artist: song.artist || song.album,
                          title: song.title,
                        })
                      : i18n.t("runtime.songCommandUnavailable", { lng, user });
                  },
                  () =>
                    i18n.t("runtime.songCommandUnavailable", {
                      lng: resolveLanguage(state().settings.language),
                      user: message.displayName || message.login,
                    }),
                )
                .then((response) => dispatchResponse(response))
                .catch((error) => {
                  toast.error(i18n.t("chat.sendError"), {
                    description: errorMessage(error),
                  });
                });
            } else {
              void dispatchResponse(cmd.response).catch((error) => {
                toast.error(i18n.t("chat.sendError"), {
                  description: errorMessage(error),
                });
              });
            }
            break;
          }
        },
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
  }, [applyTwitchAccountProfile, ingest, sendCommandReply, state]);

  const startTwitchBot = useCallback(async () => {
    if (!isTauri()) {
      state().setTwitchBot({ phase: "disconnected" });
      return;
    }
    try {
      const session = await twitchNative.session(TWITCH_CLIENT_ID, true);
      if (!session) {
        state().setTwitchBot({ phase: "disconnected" });
        return;
      }
      state().setTwitchBot({
        phase: "connected",
        account: session.login,
        userId: session.userId,
        scopes: session.scopes,
      });
    } catch (error) {
      state().setTwitchBot({
        phase: "expired",
        detail: errorMessage(error),
      });
    }
  }, [state]);

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

  const reconnect = useCallback(async () => {
    await Promise.all([
      startTwitch(),
      startTwitchBot(),
      startStreamElements(),
      startTipeeeStream(),
      startObs(),
    ]);
  }, [startTwitch, startTwitchBot, startStreamElements, startTipeeeStream, startObs]);

  const shutdown = useCallback(async () => {
    const current = state();
    if (current.ready) {
      const { nextProfiles } = buildSyncedProfiles();
      current.setProfiles(nextProfiles);
      await saveLocalState("profiles", nextProfiles).catch(() => undefined);
    }
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
  }, [buildSyncedProfiles, state]);

  const [remoteHostStopped, setRemoteHostStopped] = useState(false);
  const [remoteAuthNeeded, setRemoteAuthNeeded] = useState(false);
  const [remoteTokenInput, setRemoteTokenInput] = useState("");
  const [remoteAuthError, setRemoteAuthError] = useState<string>();

  const sendRemoteAction = useCallback(
    async (type: string, payload: Record<string, unknown> = {}) => {
      const token = sessionStorage.getItem("sd_remote_token") ?? "";
      await fetch("/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-SD-Token": token } : {}),
        },
        body: JSON.stringify({ type, payload }),
      });
    },
    [],
  );

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!isTauri()) {
        const trimmed = text.trim();
        if (trimmed) await sendRemoteAction("chat.send", { message: trimmed.slice(0, 500) });
        return;
      }
      const current = state();
      const resolved = (
        await resolveTemplateWithSong(text, {
          state: current,
          user: current.twitch.account,
          userLogin: current.twitch.account,
        })
      ).trim();
      if (!resolved) return;
      await sendChat(resolved.slice(0, 500));
    },
    [sendChat, sendRemoteAction, state],
  );

  const applyRemoteSnapshot = useCallback((snap: Record<string, unknown>) => {
    if (!snap || typeof snap !== "object" || snap.ready !== true) return false;
    useAppStore.setState((prev) => {
      const next: Record<string, unknown> = { ...prev, ready: true };
      for (const [key, val] of Object.entries(snap)) {
        if (REMOTE_IGNORED_STATE_KEYS.has(key) || val === undefined) continue;
        if (typeof (prev as unknown as Record<string, unknown>)[key] === "function") continue;
        next[key] = val;
      }
      return next as unknown as typeof prev;
    });
    return true;
  }, []);

  const runtimeMethodsRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    let remoteSse: EventSource | undefined;

    if (!isTauri()) {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get("token");
      if (urlToken) {
        sessionStorage.setItem("sd_remote_token", urlToken);
        window.history.replaceState({}, "", window.location.pathname);
      }
      const token = sessionStorage.getItem("sd_remote_token") ?? "";
      const connectSse = (tok: string) => {
        if (remoteSse) remoteSse.close();
        const q = tok ? `?token=${encodeURIComponent(tok)}` : "";
        const es = new EventSource(`/api/events${q}`);
        remoteSse = es;
        es.addEventListener("state", (ev) => {
          if (disposed) return;
          try {
            setRemoteHostStopped(false);
            applyRemoteSnapshot(JSON.parse(ev.data) as Record<string, unknown>);
          } catch {
            // ignore
          }
        });
        es.addEventListener("host_stopped", () => {
          if (disposed) return;
          setRemoteHostStopped(true);
          es.close();
          if (remoteSse === es) remoteSse = undefined;
        });
      };
      const fetchInitial = async () => {
        if (disposed) return;
        try {
          const q = token ? `?token=${encodeURIComponent(token)}` : "";
          const res = await fetch(`/api/state${q}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(4500),
          });
          if (res.status === 401) {
            if (!disposed) {
              setRemoteAuthNeeded(true);
              setReady(true);
            }
            return;
          }
          if (res.ok) {
            const snap = (await res.json()) as Record<string, unknown>;
            if (!disposed) {
              setRemoteHostStopped(false);
              setRemoteAuthNeeded(false);
              const applied = applyRemoteSnapshot(snap);
              connectSse(token);
              if (applied) return;
            }
          }
        } catch {
          // ignore and retry
        }
        if (!disposed) {
          window.setTimeout(() => void fetchInitial(), 1500);
        }
      };
      void fetchInitial();
      return () => {
        disposed = true;
        remoteSse?.close();
      };
    }

    (async () => {
      try {
        const {
          settings,
          giveaway,
          cachedStats,
          commands,
          channelRewards,
          chatAlerts,
          customVariables,
          rawProfiles,
          rawActiveProfileId,
          rawLastTwitchUserId,
          rawProfilesAutoSwitch,
          events,
          chatMessages,
        } = await loadBootstrap();
        if (disposed) return;
        setSettings(settings);
        setEvents(events);
        setChatMessages(chatMessages);
        if (Array.isArray(commands)) {
          state().setCommands(commands);
        }
        if (Array.isArray(channelRewards)) {
          state().setChannelRewards(channelRewards);
        }
        if (chatAlerts && typeof chatAlerts === "object") {
          state().setChatAlerts(chatAlerts);
        }
        if (Array.isArray(customVariables)) {
          state().setCustomVariables(customVariables);
        }
        if (giveaway && typeof giveaway === "object") {
          state().setGiveaway({
            ...giveaway,
            entries: Array.isArray(giveaway.entries) ? giveaway.entries : [],
            disqualifiedUsers: Array.isArray(giveaway.disqualifiedUsers)
              ? giveaway.disqualifiedUsers
              : [],
          });
        }
        const bits = events.reduce((n, e) => n + (e.bits ?? 0), 0);
        const donations = events.reduce((n, e) => n + (e.amount ?? 0), 0);
        state().setStats({
          ...(cachedStats && typeof cachedStats === "object" ? cachedStats : {}),
          bits,
          donations,
          donationCurrency:
            events.find((e) => e.currency)?.currency ??
            cachedStats?.donationCurrency,
        });
        const currentSnapshot = extractSnapshotFromState(state());
        const profileInit = bootstrapProfiles({
          rawProfiles,
          rawActiveProfileId,
          rawLastTwitchUserId,
          rawProfilesAutoSwitch,
          currentSnapshot,
          defaultName: i18n.t("profiles.defaultName"),
        });
        state().setProfiles(profileInit.profiles);
        state().setActiveProfileId(profileInit.activeProfileId);
        state().setLastTwitchUserId(profileInit.lastTwitchUserId);
        state().setProfilesAutoSwitch(profileInit.profilesAutoSwitch);
        if (!Array.isArray(rawProfiles) || !rawProfiles.length) {
          void saveLocalStateBatch({
            profiles: profileInit.profiles,
            activeProfileId: profileInit.activeProfileId,
            profilesAutoSwitch: profileInit.profilesAutoSwitch,
          }).catch(() => undefined);
        }
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
          await listen<{ type?: string; payload?: Record<string, unknown> }>(
            "web-host-action",
            (event) => {
              const actionType = event.payload?.type;
              const data = event.payload?.payload ?? {};
              if (actionType === "chat.send" && typeof data.message === "string") {
                void sendChatMessage(data.message);
              } else if (actionType === "obs.scene" && typeof data.scene === "string") {
                void obsRef.current?.setScene(data.scene);
              } else if (actionType === "obs.streaming") {
                void obsRef.current?.setStreaming(Boolean(data.active));
              } else if (actionType === "obs.recording") {
                void obsRef.current?.setRecording(Boolean(data.active));
              } else if (actionType === "obs.recordingPaused") {
                void obsRef.current?.setRecordingPaused(Boolean(data.paused));
              } else if (actionType === "obs.replayBuffer") {
                void obsRef.current?.setReplayBuffer(Boolean(data.active));
              } else if (actionType === "obs.replay") {
                void obsRef.current?.saveReplayBuffer();
              } else if (actionType === "obs.virtualCam") {
                void obsRef.current?.setVirtualCam(Boolean(data.active));
              } else if (actionType === "obs.mute" && typeof data.name === "string") {
                void obsRef.current?.setMute(data.name, Boolean(data.muted));
              } else if (actionType === "obs.volume" && typeof data.name === "string") {
                void obsRef.current?.setVolume(data.name, Number(data.volume ?? 1));
              } else if (actionType === "giveaway.toggle") {
                state().setGiveaway({ running: Boolean(data.active) });
              } else if (actionType === "giveaway.draw") {
                const cur = state().giveaway;
                if (cur.entries.length > 0) {
                  const winner = cur.entries[Math.floor(Math.random() * cur.entries.length)];
                  state().setGiveaway({ winner, running: false });
                }
              } else if (actionType === "giveaway.reset") {
                state().setGiveaway({ running: false, entries: [], winner: undefined });
              } else if (actionType === "reconnect") {
                void reconnect();
              } else if (actionType === "events.clear") {
                state().clearEvents();
              } else if (actionType === "chat.clear") {
                state().clearChat();
              } else if (actionType === "companion.settings" && data && typeof data === "object") {
                const nextCompanion = {
                  ...state().settings.companion,
                  ...(data as Record<string, unknown>),
                };
                state().setSettings({ companion: nextCompanion });
                void saveLocalState("companion", nextCompanion);
              } else if (actionType === "runtime.call" && typeof data.method === "string") {
                const method = data.method;
                const fn = runtimeMethodsRef.current[method];
                if (!REMOTE_BLOCKED_METHODS.has(method) && typeof fn === "function") {
                  const args = Array.isArray(data.args) ? data.args : [];
                  void Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)).catch(
                    (err) => {
                      console.error("Remote runtime call failed", method, errorMessage(err));
                    },
                  );
                }
              } else if (actionType === "state.save" && typeof data.key === "string") {
                const key = data.key;
                const val = data.value;
                void saveLocalState(key, val);
                const cur = state() as unknown as Record<string, unknown>;
                if (!REMOTE_IGNORED_STATE_KEYS.has(key) && key in cur && typeof cur[key] !== "function") {
                  useAppStore.setState({ [key]: val } as never);
                } else if (key in state().settings) {
                  state().setSettings({ [key]: val } as never);
                }
              } else if (actionType === "state.saveBatch" && data.entries && typeof data.entries === "object") {
                const entries = data.entries as Record<string, unknown>;
                void saveLocalStateBatch(entries);
                const cur = state() as unknown as Record<string, unknown>;
                const storePatch: Record<string, unknown> = {};
                const settingsPatch: Record<string, unknown> = {};
                for (const [key, val] of Object.entries(entries)) {
                  if (!REMOTE_IGNORED_STATE_KEYS.has(key) && key in cur && typeof cur[key] !== "function") {
                    storePatch[key] = val;
                  } else if (key in state().settings) {
                    settingsPatch[key] = val;
                  }
                }
                if (Object.keys(storePatch).length > 0) {
                  useAppStore.setState(storePatch as never);
                }
                if (Object.keys(settingsPatch).length > 0) {
                  state().setSettings(settingsPatch as never);
                }
              }
            },
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
  }, [applyRemoteSnapshot, reconnect, sendChatMessage, setChatMessages, setEvents, setReady, setSettings, state]);

  useEffect(() => {
    if (!isTauri()) return;
    let timer: number | undefined;
    const publish = () => {
      const s = useAppStore.getState();
      if (!s.ready) return;
      void webHostNative.publishState(serializeHostSnapshot(s));
    };
    publish();
    const unsub = useAppStore.subscribe(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(publish, 150);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const connectTwitch = async () => {
    const attempt = ++twitchAuthAttemptRef.current;
    try {
      state().setTwitch({
        phase: "connecting",
        detail: i18n.t("runtime.waitingAuthorization"),
      });
      const device = await twitchNative.deviceStart(
        TWITCH_CLIENT_ID,
        TWITCH_SCOPES,
      );
      if (twitchAuthAttemptRef.current !== attempt) return;
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
        if (twitchAuthAttemptRef.current !== attempt) return;
        const result = await twitchNative.devicePoll(
          TWITCH_CLIENT_ID,
          device.device_code,
          TWITCH_SCOPES,
        );
        if (twitchAuthAttemptRef.current !== attempt) return;
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
      if (twitchAuthAttemptRef.current !== attempt) return;
      setDeviceAuth(undefined);
      state().setTwitch({ phase: "error", detail: errorMessage(error) });
      toast.error(i18n.t("runtime.connectError"), {
        description: errorMessage(error),
      });
    }
  };
  const disconnectTwitch = async () => {
    twitchAuthAttemptRef.current++;
    setDeviceAuth(undefined);
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
  const connectTwitchBot = async () => {
    const attempt = ++botAuthAttemptRef.current;
    try {
      state().setTwitchBot({
        phase: "connecting",
        detail: i18n.t("runtime.waitingAuthorization"),
      });
      const device = await twitchNative.deviceStart(
        TWITCH_CLIENT_ID,
        TWITCH_BOT_SCOPES,
      );
      if (botAuthAttemptRef.current !== attempt) return;
      setBotDeviceAuth({
        code: device.user_code,
        url: device.verification_uri,
        expiresAt: Date.now() + device.expires_in * 1000,
      });
      await openUrl(device.verification_uri);
      let interval = Math.max(device.interval, 1) * 1000;
      const expiresAt = Date.now() + device.expires_in * 1000;
      while (Date.now() < expiresAt) {
        await new Promise((r) => setTimeout(r, interval));
        if (botAuthAttemptRef.current !== attempt) return;
        const result = await twitchNative.devicePoll(
          TWITCH_CLIENT_ID,
          device.device_code,
          TWITCH_BOT_SCOPES,
          true,
        );
        if (botAuthAttemptRef.current !== attempt) return;
        if (result.status === "authorized") {
          setBotDeviceAuth(undefined);
          toast.success(i18n.t("runtime.twitchBotConnected"));
          await startTwitchBot();
          return;
        }
        if (result.status === "slow_down") interval += 5000;
      }
      throw new Error(i18n.t("runtime.codeExpired"));
    } catch (error) {
      if (botAuthAttemptRef.current !== attempt) return;
      setBotDeviceAuth(undefined);
      state().setTwitchBot({ phase: "error", detail: errorMessage(error) });
      toast.error(i18n.t("runtime.connectBotError"), {
        description: errorMessage(error),
      });
    }
  };
  const disconnectTwitchBot = async () => {
    botAuthAttemptRef.current++;
    setBotDeviceAuth(undefined);
    await secretDelete("twitch-bot-oauth");
    state().setTwitchBot({ phase: "disconnected" });
  };
  const reauthorizeTwitchBot = async () => {
    await disconnectTwitchBot();
    await connectTwitchBot();
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
    !isTauri()
      ? sendRemoteAction("obs.scene", { scene })
      : obsAction((client) => client.setScene(scene));
  const setObsMute = (input: string, muted: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.mute", { name: input, muted })
      : obsAction((client) => client.setMute(input, muted));
  const setObsVolume = (input: string, volume: number) =>
    !isTauri()
      ? sendRemoteAction("obs.volume", { name: input, volume })
      : obsAction((client) => client.setVolume(input, volume));
  const setObsStreaming = (active: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.streaming", { active })
      : obsAction((client) => client.setStreaming(active));
  const setObsRecording = (active: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.recording", { active })
      : obsAction((client) => client.setRecording(active));
  const setObsRecordingPaused = (paused: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.recordingPaused", { paused })
      : obsAction((client) => client.setRecordingPaused(paused));
  const setObsReplayBuffer = (active: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.replayBuffer", { active })
      : obsAction((client) => client.setReplayBuffer(active));
  const saveObsReplayBuffer = () =>
    !isTauri()
      ? sendRemoteAction("obs.replay")
      : obsAction((client) => client.saveReplayBuffer());
  const setObsVirtualCam = (active: boolean) =>
    !isTauri()
      ? sendRemoteAction("obs.virtualCam", { active })
      : obsAction((client) => client.setVirtualCam(active));

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

  const switchProfile = async (profileId: string) => {
    const current = state();
    const { nextProfiles } = buildSyncedProfiles();
    const target = nextProfiles.find((p) => p.id === profileId);
    if (!target || target.id === current.activeProfileId) return;
    await applySnapshotAndPersist(
      target.data,
      { profiles: nextProfiles, activeProfileId: target.id },
      { preserveLiveStats: true },
    );
    toast.success(i18n.t("profiles.switched", { name: target.name }));
  };

  const createProfile = async (options: CreateProfileOptions) => {
    const current = state();
    const { nextProfiles, snapshot } = buildSyncedProfiles();
    const now = Date.now();
    const name = options.name.trim() || i18n.t("profiles.defaultName");
    const twitchId =
      options.linkCurrentTwitch && current.twitch.userId
        ? current.twitch.userId
        : undefined;
    const twitchLogin =
      options.linkCurrentTwitch && current.twitch.account
        ? current.twitch.account
        : undefined;
    const newId = createProfileId("profile");
    const newSnapshot =
      options.template === "copy"
        ? cloneJson(snapshot)
        : createCleanSnapshot(snapshot.settings);
    const updatedList = twitchId
      ? nextProfiles.map((p) =>
          p.twitchUserId === twitchId
            ? { ...p, twitchUserId: undefined, twitchLogin: undefined }
            : p,
        )
      : nextProfiles;
    const created: UserProfile = {
      id: newId,
      name,
      twitchUserId: twitchId,
      twitchLogin,
      createdAt: now,
      updatedAt: now,
      data: newSnapshot,
    };
    const finalProfiles = [...updatedList, created];
    await applySnapshotAndPersist(
      created.data,
      { profiles: finalProfiles, activeProfileId: created.id },
      { preserveLiveStats: true },
    );
    toast.success(i18n.t("profiles.created", { name: created.name }));
    return created.id;
  };

  const renameProfile = async (profileId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { nextProfiles } = buildSyncedProfiles();
    const updated = nextProfiles.map((p) =>
      p.id === profileId ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
    );
    state().setProfiles(updated);
    await saveLocalState("profiles", updated);
  };

  const duplicateProfile = async (profileId: string) => {
    const { nextProfiles } = buildSyncedProfiles();
    const source = nextProfiles.find((p) => p.id === profileId);
    if (!source) return "";
    const now = Date.now();
    const copy: UserProfile = {
      ...cloneJson(source),
      id: createProfileId("profile"),
      name: `${source.name} (${i18n.t("profiles.copySuffix")})`,
      twitchUserId: undefined,
      twitchLogin: undefined,
      createdAt: now,
      updatedAt: now,
    };
    const finalProfiles = [...nextProfiles, copy];
    state().setProfiles(finalProfiles);
    await saveLocalState("profiles", finalProfiles);
    toast.success(i18n.t("profiles.duplicated", { name: copy.name }));
    return copy.id;
  };

  const deleteProfile = async (profileId: string) => {
    const current = state();
    const { nextProfiles } = buildSyncedProfiles();
    if (nextProfiles.length <= 1) return;
    const remaining = nextProfiles.filter((p) => p.id !== profileId);
    if (profileId === current.activeProfileId) {
      const nextActive = remaining[0];
      await applySnapshotAndPersist(
        nextActive.data,
        { profiles: remaining, activeProfileId: nextActive.id },
        { preserveLiveStats: true },
      );
    } else {
      current.setProfiles(remaining);
      await saveLocalState("profiles", remaining);
    }
    toast.success(i18n.t("profiles.deleted"));
  };

  const linkProfileToTwitch = async (profileId: string, link: boolean) => {
    const current = state();
    const { nextProfiles } = buildSyncedProfiles();
    const userId = current.twitch.userId;
    const login = current.twitch.account;
    if (link && (!userId || !login)) return;
    const now = Date.now();
    const updated = nextProfiles.map((p) => {
      if (p.id === profileId) {
        return {
          ...p,
          twitchUserId: link ? userId : undefined,
          twitchLogin: link ? login : undefined,
          updatedAt: now,
        };
      }
      if (link && userId && p.twitchUserId === userId) {
        return {
          ...p,
          twitchUserId: undefined,
          twitchLogin: undefined,
          updatedAt: now,
        };
      }
      return p;
    });
    current.setProfiles(updated);
    await saveLocalState("profiles", updated);
  };

  const setProfilesAutoSwitchPref = async (enabled: boolean) => {
    state().setProfilesAutoSwitch(enabled);
    await saveLocalState("profilesAutoSwitch", enabled);
  };

  const exportProfiles = async (options: ExportProfileOptions) => {
    const { nextProfiles } = buildSyncedProfiles();
    state().setProfiles(nextProfiles);
    await saveLocalState("profiles", nextProfiles).catch(() => undefined);

    const appVersion = isTauri()
      ? await getVersion().catch(() => undefined)
      : undefined;
    const current = state();
    const bundle = createExportBundle({
      scope: options.scope,
      profiles: nextProfiles,
      activeProfileId: current.activeProfileId,
      targetProfileId: options.targetProfileId,
      included: options.included,
      appVersion,
      events: options.included.history ? current.events : undefined,
      chatMessages: options.included.history ? current.chatMessages : undefined,
    });
    const json = JSON.stringify(bundle, null, 2);
    if (options.mode === "clipboard") {
      await navigator.clipboard.writeText(json);
      toast.success(i18n.t("profiles.copiedToClipboard"));
      return "copied" as const;
    }
    const targetName =
      options.scope === "all"
        ? "all"
        : (
            nextProfiles.find(
              (p) => p.id === (options.targetProfileId ?? current.activeProfileId),
            )?.name ?? "profile"
          )
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "profile";
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `streamdash-${targetName}-${dateStamp}.json`;
    const result = await saveJsonFile(filename, json);
    if (result === "saved") {
      toast.success(i18n.t("profiles.exportSuccess"));
    }
    return result;
  };

  const importProfiles = async (
    bundle: ProfileExportBundle,
    options: ImportProfileOptions,
  ) => {
    const current = state();
    const { nextProfiles, snapshot: activeSnapshot } = buildSyncedProfiles();
    const now = Date.now();
    let finalProfiles = [...nextProfiles];
    let nextActiveId = current.activeProfileId;

    if (options.mode === "replace_all") {
      finalProfiles = bundle.profiles.map((incoming) => ({
        ...cloneJson(incoming),
        data: mergeSnapshotSections(
          createCleanSnapshot(activeSnapshot.settings),
          incoming.data,
          options.sections,
        ),
        updatedAt: now,
      }));
      const preferred =
        bundle.activeProfileId &&
        finalProfiles.some((p) => p.id === bundle.activeProfileId)
          ? bundle.activeProfileId
          : finalProfiles[0].id;
      nextActiveId = preferred;
    } else if (options.mode === "merge") {
      const byId = new Map(finalProfiles.map((p) => [p.id, p]));
      const byTwitch = new Map(
        finalProfiles
          .filter((p) => p.twitchUserId)
          .map((p) => [p.twitchUserId as string, p]),
      );
      for (const incoming of bundle.profiles) {
        const match =
          byId.get(incoming.id) ??
          (incoming.twitchUserId ? byTwitch.get(incoming.twitchUserId) : undefined);
        if (match) {
          const mergedData = mergeSnapshotSections(
            match.data,
            incoming.data,
            options.sections,
            { mergeCollections: options.mergeCollections },
          );
          const updatedProfile: UserProfile = {
            ...match,
            twitchLogin: incoming.twitchLogin ?? match.twitchLogin,
            updatedAt: now,
            data: mergedData,
          };
          finalProfiles = finalProfiles.map((p) =>
            p.id === match.id ? updatedProfile : p,
          );
          if (
            options.activateAfterImport &&
            incoming.id === (bundle.activeProfileId ?? bundle.profiles[0]?.id)
          ) {
            nextActiveId = match.id;
          }
        } else {
          const newId = byId.has(incoming.id)
            ? createProfileId("profile")
            : incoming.id;
          const cleanBase = createCleanSnapshot(activeSnapshot.settings);
          const added: UserProfile = {
            ...cloneJson(incoming),
            id: newId,
            createdAt: now,
            updatedAt: now,
            data: mergeSnapshotSections(cleanBase, incoming.data, options.sections),
          };
          finalProfiles.push(added);
          byId.set(added.id, added);
          if (
            options.activateAfterImport &&
            incoming.id === (bundle.activeProfileId ?? bundle.profiles[0]?.id)
          ) {
            nextActiveId = added.id;
          }
        }
      }
    } else {
      const sourceProfile = bundle.profiles[0];
      if (!sourceProfile) return;

      if (options.mode === "overwrite") {
        const target =
          finalProfiles.find((p) => p.id === current.activeProfileId) ??
          finalProfiles[0];
        const merged = mergeSnapshotSections(
          target.data,
          sourceProfile.data,
          options.sections,
          { mergeCollections: options.mergeCollections },
        );
        finalProfiles = finalProfiles.map((p) =>
          p.id === target.id ? { ...p, data: merged, updatedAt: now } : p,
        );
        nextActiveId = target.id;
      } else {
        const cleanBase = createCleanSnapshot(activeSnapshot.settings);
        const merged = mergeSnapshotSections(
          cleanBase,
          sourceProfile.data,
          options.sections,
        );
        const linkTwitchId =
          options.linkCurrentTwitch && current.twitch.userId
            ? current.twitch.userId
            : sourceProfile.twitchUserId;
        const linkTwitchLogin =
          options.linkCurrentTwitch && current.twitch.account
            ? current.twitch.account
            : sourceProfile.twitchLogin;
        if (linkTwitchId) {
          finalProfiles = finalProfiles.map((p) =>
            p.twitchUserId === linkTwitchId
              ? { ...p, twitchUserId: undefined, twitchLogin: undefined }
              : p,
          );
        }
        const created: UserProfile = {
          id: createProfileId("profile"),
          name: options.profileName?.trim() || sourceProfile.name,
          twitchUserId: linkTwitchId,
          twitchLogin: linkTwitchLogin,
          createdAt: now,
          updatedAt: now,
          data: merged,
        };
        finalProfiles.push(created);
        if (options.activateAfterImport !== false) {
          nextActiveId = created.id;
        }
      }
    }

    const activeTarget =
      finalProfiles.find((p) => p.id === nextActiveId) ?? finalProfiles[0];
    if (activeTarget.id === current.activeProfileId || options.mode === "overwrite" || options.activateAfterImport !== false) {
      await applySnapshotAndPersist(
        activeTarget.data,
        { profiles: finalProfiles, activeProfileId: activeTarget.id },
        { preserveLiveStats: true },
      );
    } else {
      current.setProfiles(finalProfiles);
      await saveLocalState("profiles", finalProfiles);
    }

    if (options.sections.history && (bundle.events?.length || bundle.chatMessages?.length)) {
      const incomingEvents = bundle.events ?? [];
      const incomingChat = bundle.chatMessages ?? [];
      const maxEvents = activeTarget.data.settings.maximumEvents ?? 5000;
      const maxChat = activeTarget.data.settings.maximumChatMessages ?? 1000;
      await importHistoryBatch(incomingEvents, incomingChat, maxEvents, maxChat);
      const [events, chatMessages] = await Promise.all([
        loadEvents(maxEvents),
        loadChatMessages(maxChat),
      ]);
      if (isTauri()) {
        current.setEvents(events);
        current.setChatMessages(chatMessages);
      } else {
        current.setEvents(
          [...incomingEvents, ...current.events].slice(0, maxEvents),
        );
        current.setChatMessages(
          [...current.chatMessages, ...incomingChat].slice(-maxChat),
        );
      }
    }

    toast.success(
      i18n.t("profiles.importSuccess", { count: bundle.profiles.length }),
    );
  };

  const rawRuntimeValue: RuntimeValue = {
    deviceAuth,
    botDeviceAuth,
    connectTwitch,
    disconnectTwitch,
    reauthorizeTwitch,
    connectTwitchBot,
    disconnectTwitchBot,
    reauthorizeTwitchBot,
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
    sendBotChatMessage: sendCommandReply,
    getChatUserProfile,
    moderateChatUser,
    unbanChatUser,
    deleteChatMessage,
    setChatUserRole,
    switchProfile,
    createProfile,
    renameProfile,
    duplicateProfile,
    deleteProfile,
    linkProfileToTwitch,
    setProfilesAutoSwitch: setProfilesAutoSwitchPref,
    exportProfiles,
    importProfiles,
    reconnect,
    shutdown,
  };

  const sendRemoteActionRef = useRef(sendRemoteAction);

  useEffect(() => {
    runtimeMethodsRef.current = { ...rawRuntimeValue };
    sendRemoteActionRef.current = sendRemoteAction;
  });

  const isTauriHost = isTauri();
  const providerValue: RuntimeValue = useMemo(
    () =>
      createStableRuntimeProxy(
        { deviceAuth, botDeviceAuth },
        () => runtimeMethodsRef.current,
        () => sendRemoteActionRef.current,
        !isTauriHost,
      ),
    [deviceAuth, botDeviceAuth, isTauriHost],
  );

  if (!isTauri() && remoteHostStopped) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-ink">
        <div className="w-full max-w-sm space-y-4 rounded-xl border border-rule-strong bg-panel p-6 shadow-lg">
          <div className="space-y-1.5">
            <h1 className="text-base font-semibold">{i18n.t("host.hostStoppedTitle")}</h1>
            <p className="text-xs leading-relaxed text-zinc-400">
              {i18n.t("host.hostStoppedDetail")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {i18n.t("host.reconnectButton")}
          </button>
        </div>
      </div>
    );
  }

  if (!isTauri() && remoteAuthNeeded) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-4 text-ink">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setRemoteAuthError(undefined);
            const tok = remoteTokenInput.trim();
            if (!tok) return;
            try {
              const res = await fetch(`/api/state?token=${encodeURIComponent(tok)}`);
              if (res.status === 401) {
                setRemoteAuthError(i18n.t("host.invalidToken"));
                return;
              }
              if (res.ok) {
                sessionStorage.setItem("sd_remote_token", tok);
                window.location.reload();
              }
            } catch {
              setRemoteAuthError(i18n.t("host.configError"));
            }
          }}
          className="w-full max-w-sm space-y-4 rounded-xl border border-rule-strong bg-panel p-6 shadow-lg"
        >
          <div className="space-y-1">
            <h1 className="text-base font-semibold">{i18n.t("host.title")}</h1>
            <p className="text-xs text-zinc-400">{i18n.t("host.authPrompt")}</p>
          </div>
          <input
            type="password"
            className="input w-full font-mono text-sm"
            placeholder={i18n.t("host.tokenLabel")}
            value={remoteTokenInput}
            onChange={(e) => setRemoteTokenInput(e.target.value)}
            autoFocus
          />
          {remoteAuthError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {remoteAuthError}
            </div>
          )}
          <button
            type="submit"
            className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {i18n.t("host.connectButton")}
          </button>
        </form>
      </div>
    );
  }

  return (
    <RuntimeContext.Provider value={providerValue}>
      {children}
    </RuntimeContext.Provider>
  );
}
