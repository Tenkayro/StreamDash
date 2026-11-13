import {
  useCallback,
  useEffect,
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
import { useAppStore } from "../stores/app-store";
import { errorMessage, isTauri, money } from "../lib/utils";
import { cloudSyncLimiter, parseRateLimitWaitSeconds } from "../lib/cloud-sync-limiter";
import {
  bootstrapProfiles,
  buildPersistenceBatch,
  cloneJson,
  computeCloudBundleHash,
  createCleanSnapshot,
  createCloudSyncBundle,
  createExportBundle,
  createProfileId,
  extractSnapshotFromState,
  isFreshDefaultProfileSetup,
  mergeSnapshotSections,
  normalizeCloudBundle,
  normalizeProfileSnapshot,
  resolveProfileForTwitchAccount,
  saveJsonFile,
} from "../lib/profiles";
import {
  cloudSyncNative,
  historySyncNative,
  importHistoryBatch,
  loadChatMessages,
  loadEvents,
  loadSettings,
  mergeEvents,
  proNative,
  saveChatMessage,
  supportNative,
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
  CloudSyncRemoteMeta,
  CloudSyncUserCheckpoint,
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
  rawCloudSyncEnabled?: unknown;
  rawCloudSyncCheckpoints?: unknown;
  events: ActivityEvent[];
  chatMessages: ChatMessage[];
};

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
      cloudSyncEnabled: rawCloudSyncEnabled,
      cloudSyncCheckpoints: rawCloudSyncCheckpoints,
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
      cloudSyncEnabled?: unknown;
      cloudSyncCheckpoints?: unknown;
    };
    const settings: Partial<AppSettings> = { ...restSettings };
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
      rawCloudSyncEnabled,
      rawCloudSyncCheckpoints,
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
  const cloudSyncInFlightRef = useRef(false);
  const cloudPushTimerRef = useRef<number | undefined>(undefined);
  const cloudSyncPhase = useAppStore((s) => s.cloudSync.phase);
  const cloudSyncEnabled = useAppStore((s) => s.cloudSyncEnabled);
  const proActive = useAppStore((s) => s.entitlements.pro);
  const profilesList = useAppStore((s) => s.profiles);
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
      } else if (event.eventType === "follow" && alerts.follower.enabled) {
        alertTemplate = alerts.follower.message;
      } else if (event.eventType === "stream_online" && alerts.goLive.enabled) {
        alertTemplate = alerts.goLive.message;
      }

      if (alertTemplate && current.twitch.phase === "connected") {
        const tierLabel = isPrime
          ? "Prime Gaming"
          : tier === "3000"
            ? "Tier 3"
            : tier === "2000"
              ? "Tier 2"
              : "Tier 1";
        const formatted = resolveVariables(alertTemplate, {
          state: state(),
          user,
          userLogin: event.username || user,
          alertData: {
            months,
            recipient: recipient || user,
            amount: event.giftCount ?? event.amount ?? 1,
            bits: event.bits ?? 0,
            viewers: event.viewerCount,
            tier: tierLabel,
            game: gameName,
            title: streamTitle,
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
    },
    [state],
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

  const setCloudSyncCheckpoint = useCallback(
    async (userId: string, checkpoint: CloudSyncUserCheckpoint | undefined) => {
      const current = state();
      const next = { ...current.cloudSyncCheckpoints };
      if (checkpoint) next[userId] = checkpoint;
      else delete next[userId];
      current.setCloudSyncCheckpoints(next);
      await saveLocalState("cloudSyncCheckpoints", next).catch(() => undefined);
    },
    [state],
  );

  const buildLocalCloudPayload = useCallback(async () => {
    const current = state();
    const { nextProfiles } = buildSyncedProfiles();
    const appVersion = isTauri()
      ? await getVersion().catch(() => undefined)
      : undefined;
    const bundle = createCloudSyncBundle({
      profiles: nextProfiles,
      activeProfileId: current.activeProfileId,
      appVersion,
    });
    const localSha256 = await computeCloudBundleHash(bundle);
    return { nextProfiles, bundle, localSha256 };
  }, [buildSyncedProfiles, state]);

  const applyPulledCloudBundle = useCallback(
    async (
      userId: string,
      rawBundle: unknown,
      remoteMeta: CloudSyncRemoteMeta,
      mergeMode = false,
    ) => {
      const parsed = normalizeCloudBundle(rawBundle);
      if (!parsed || !parsed.profiles.length) {
        throw new Error(i18n.t("profiles.cloud.invalidRemoteBundle"));
      }
      const current = state();
      const { nextProfiles, snapshot: activeSnapshot } = buildSyncedProfiles();
      const now = Date.now();
      let finalProfiles = cloneJson(parsed.profiles);
      let nextActiveId =
        parsed.activeProfileId &&
        finalProfiles.some((p) => p.id === parsed.activeProfileId)
          ? parsed.activeProfileId
          : finalProfiles[0].id;

      if (mergeMode) {
        const mergedList = [...nextProfiles];
        const byId = new Map(mergedList.map((p) => [p.id, p]));
        const byTwitch = new Map(
          mergedList
            .filter((p) => p.twitchUserId)
            .map((p) => [p.twitchUserId as string, p]),
        );
        for (const incoming of finalProfiles) {
          const match =
            byId.get(incoming.id) ??
            (incoming.twitchUserId ? byTwitch.get(incoming.twitchUserId) : undefined);
          if (match) {
            const updated: UserProfile = {
              ...match,
              name: incoming.name || match.name,
              twitchUserId: incoming.twitchUserId ?? match.twitchUserId,
              twitchLogin: incoming.twitchLogin ?? match.twitchLogin,
              updatedAt: now,
              data: mergeSnapshotSections(match.data, incoming.data, {
                appearance: true,
                dashboard: true,
                chatAndObs: true,
                automation: true,
              }),
            };
            const idx = mergedList.findIndex((p) => p.id === match.id);
            if (idx >= 0) mergedList[idx] = updated;
          } else {
            mergedList.push({ ...incoming, updatedAt: now });
          }
        }
        finalProfiles = mergedList;
        if (!finalProfiles.some((p) => p.id === current.activeProfileId)) {
          nextActiveId = finalProfiles[0].id;
        } else {
          nextActiveId = current.activeProfileId;
        }
      } else {
        const cleanBase = createCleanSnapshot(activeSnapshot.settings);
        finalProfiles = finalProfiles.map((incoming) => ({
          ...incoming,
          data: mergeSnapshotSections(cleanBase, incoming.data, {
            appearance: true,
            dashboard: true,
            chatAndObs: true,
            automation: true,
          }),
        }));
      }

      const activeTarget =
        finalProfiles.find((p) => p.id === nextActiveId) ?? finalProfiles[0];
      await applySnapshotAndPersist(
        activeTarget.data,
        { profiles: finalProfiles, activeProfileId: activeTarget.id },
        { preserveLiveStats: true },
      );

      const appliedBundle = createCloudSyncBundle({
        profiles: finalProfiles,
        activeProfileId: activeTarget.id,
      });
      const localSha256 = await computeCloudBundleHash(appliedBundle);
      const syncedAt = Date.now();
      await setCloudSyncCheckpoint(userId, {
        revision: remoteMeta.revision ?? 1,
        localSha256,
        serverSha256: remoteMeta.payloadSha256,
        syncedAt,
        lastCheckedAt: syncedAt,
        serverUpdatedAt: remoteMeta.serverUpdatedAt,
        rawBytes: remoteMeta.rawBytes,
        profileCount: remoteMeta.profileCount ?? finalProfiles.length,
      });
      state().setCloudSync({
        phase: "synced",
        lastSyncedAt: syncedAt,
        lastCheckedAt: syncedAt,
        hasLocalChanges: false,
        remoteMeta,
        conflict: undefined,
        error: undefined,
      });
    },
    [applySnapshotAndPersist, buildSyncedProfiles, setCloudSyncCheckpoint, state],
  );

  const syncHistoryWithCloud = useCallback(
    async (userId: string, mode: "smart" | "push" | "pull" = "smart") => {
      if (!isTauri() || !userId || !state().entitlements.pro) return;
      try {
        const meta = await historySyncNative.meta(TWITCH_CLIENT_ID);
        if (meta.storage) {
          state().setCloudSync({ storageInfo: meta.storage, historyError: undefined });
        }

        if (mode === "pull" || (mode === "smart" && meta.exists)) {
          const pulled = await historySyncNative.pull(TWITCH_CLIENT_ID);
          if (pulled.payload?.events?.length) {
            const inserted = await mergeEvents(pulled.payload.events, 50_000);
            if (inserted > 0) {
              const refreshed = await loadEvents(5000);
              state().setEvents(refreshed);
            }
          }
          if (pulled.payload?.stats) {
            const cur = state().stats;
            const rem = pulled.payload.stats;
            const mergedStats = {
              ...cur,
              followers: Math.max(cur.followers ?? 0, rem.followers ?? 0) || undefined,
              subscribers: Math.max(cur.subscribers ?? 0, rem.subscribers ?? 0) || undefined,
              viewers: cur.viewers ?? rem.viewers,
              donations: Math.max(cur.donations ?? 0, rem.donations ?? 0),
              donationCurrency: cur.donationCurrency || rem.donationCurrency,
              bits: Math.max(cur.bits ?? 0, rem.bits ?? 0),
              startedAt: cur.startedAt || rem.startedAt,
              title: cur.title || rem.title,
              category: cur.category || rem.category,
            };
            state().setStats(mergedStats);
            await saveLocalState("cachedStats", mergedStats);
          }
          state().setCloudSync({
            storageInfo: pulled.storage ?? meta.storage,
            historyLastSyncedAt: Date.now(),
            historyError: undefined,
          });
        }

        if (mode === "push" || mode === "smart") {
          const events = await loadEvents(50_000);
          const pushed = await historySyncNative.push(TWITCH_CLIENT_ID, {
            payload: {
              version: 1,
              exportedAt: Date.now(),
              events,
              stats: state().stats,
            },
          });
          state().setCloudSync({
            storageInfo: pushed.storage,
            historyLastSyncedAt: Date.now(),
            historyError: undefined,
          });
        }
      } catch (err) {
        const msg = errorMessage(err);
        state().setCloudSync({ historyError: msg });
        if (msg.includes("storage_quota_exceeded")) {
          toast.warning(i18n.t("profiles.cloud.storage.quotaExceededToast"));
        } else if (msg.includes("storage_pool_full")) {
          toast.warning(i18n.t("profiles.cloud.storage.poolFullToast"));
        }
      }
    },
    [state],
  );

  const pushLocalToCloud = useCallback(
    async (
      userId: string,
      options?: { expectedRevision?: number; force?: boolean; notifyConflict?: boolean },
    ) => {
      const { bundle, localSha256 } = await buildLocalCloudPayload();
      const result = await cloudSyncNative.push(TWITCH_CLIENT_ID, {
        bundle,
        updatedAt: Date.now(),
        expectedRevision: options?.expectedRevision,
        force: options?.force,
      });
      if (!result.ok) {
        if ("conflict" in result) {
          const remoteBundle = normalizeCloudBundle(result.bundle);
          state().setCloudSync({
            phase: "conflict",
            remoteMeta: result.meta,
            conflict: { remoteMeta: result.meta, remoteBundle },
            error: undefined,
          });
          if (options?.notifyConflict) {
            toast.warning(i18n.t("profiles.cloud.conflictToast"));
          }
          return "conflict" as const;
        }
        state().setEntitlements({ tier: "free", pro: false, features: [], license: undefined });
        state().setCloudSync({ phase: "idle", error: undefined });
        return "pro_required" as const;
      }

      const syncedAt = Date.now();
      await setCloudSyncCheckpoint(userId, {
        revision: result.meta.revision ?? 1,
        localSha256,
        serverSha256: result.meta.payloadSha256,
        syncedAt,
        lastCheckedAt: syncedAt,
        serverUpdatedAt: result.meta.serverUpdatedAt,
        rawBytes: result.meta.rawBytes,
        profileCount: result.meta.profileCount ?? bundle.profiles.length,
      });
      state().setCloudSync({
        phase: "synced",
        lastSyncedAt: syncedAt,
        lastCheckedAt: syncedAt,
        hasLocalChanges: false,
        remoteMeta: result.meta,
        conflict: undefined,
        error: undefined,
      });
      return "synced" as const;
    },
    [buildLocalCloudPayload, setCloudSyncCheckpoint, state],
  );

  const reconcileCloudOnConnect = useCallback(
    async (
      userId: string,
      accountLogin: string,
      options?: { force?: boolean; manual?: boolean },
    ): Promise<"noop" | "pushed" | "pulled" | "conflict" | "skipped"> => {
      if (
        !isTauri() ||
        (!options?.manual && !state().cloudSyncEnabled) ||
        !state().entitlements.pro ||
        cloudSyncInFlightRef.current
      ) {
        return "skipped";
      }
      if (!options?.force && !cloudSyncLimiter.canAutoReconcile(userId)) {
        const checkpoint = state().cloudSyncCheckpoints[userId];
        if (checkpoint) {
          const { localSha256 } = await buildLocalCloudPayload();
          const localDirty = localSha256 !== checkpoint.localSha256;
          if (!localDirty) {
            state().setCloudSync({
              phase: "synced",
              lastSyncedAt: checkpoint.syncedAt,
              lastCheckedAt: checkpoint.lastCheckedAt ?? state().cloudSync.lastCheckedAt,
              hasLocalChanges: false,
              conflict: undefined,
              error: undefined,
            });
            return "noop";
          }
        }
        return "skipped";
      }
      cloudSyncInFlightRef.current = true;
      state().setCloudSync({ phase: "syncing", error: undefined });
      try {
        const remoteMeta = await cloudSyncNative.meta(TWITCH_CLIENT_ID);
        if (state().twitch.userId !== userId) return "skipped";
        if (remoteMeta.proRequired) {
          cloudSyncLimiter.invalidateEntitlements(userId);
          state().setEntitlements({ tier: "free", pro: false, features: [], license: undefined });
          state().setCloudSync({ phase: "idle", error: undefined });
          return "skipped";
        }

        const now = Date.now();
        cloudSyncLimiter.markAutoReconciled(userId, now);
        const checkpoint = state().cloudSyncCheckpoints[userId];
        const { nextProfiles, localSha256 } = await buildLocalCloudPayload();

        if (!remoteMeta.exists) {
          const pushResult = await pushLocalToCloud(userId, { expectedRevision: 0 });
          return pushResult === "synced" ? "pushed" : "conflict";
        }

        if (!checkpoint) {
          const pulled = await cloudSyncNative.pull(TWITCH_CLIENT_ID);
          if (!("bundle" in pulled)) {
            const pushResult = await pushLocalToCloud(userId, { expectedRevision: 0 });
            return pushResult === "synced" ? "pushed" : "conflict";
          }
          const remoteNormalized = normalizeCloudBundle(pulled.bundle);
          const remoteLocalSha = remoteNormalized
            ? await computeCloudBundleHash(remoteNormalized)
            : undefined;
          if (remoteLocalSha && remoteLocalSha === localSha256) {
            const syncedAt = Date.now();
            await setCloudSyncCheckpoint(userId, {
              revision: pulled.meta.revision ?? 1,
              localSha256,
              serverSha256: pulled.meta.payloadSha256,
              syncedAt,
              lastCheckedAt: syncedAt,
              serverUpdatedAt: pulled.meta.serverUpdatedAt,
              rawBytes: pulled.meta.rawBytes,
              profileCount: pulled.meta.profileCount,
            });
            state().setCloudSync({
              phase: "synced",
              lastSyncedAt: syncedAt,
              lastCheckedAt: syncedAt,
              hasLocalChanges: false,
              remoteMeta: pulled.meta,
              conflict: undefined,
              error: undefined,
            });
            return "noop";
          }

          if (isFreshDefaultProfileSetup(nextProfiles)) {
            await applyPulledCloudBundle(userId, pulled.bundle, pulled.meta, false);
            toast.success(
              i18n.t("profiles.cloud.restoredToast", { account: accountLogin }),
            );
            if (!options?.manual) void syncHistoryWithCloud(userId, "smart");
            return "pulled";
          }

          state().setCloudSync({
            phase: "conflict",
            lastCheckedAt: now,
            remoteMeta: pulled.meta,
            conflict: { remoteMeta: pulled.meta, remoteBundle: remoteNormalized },
            error: undefined,
          });
          toast.warning(i18n.t("profiles.cloud.conflictToast"));
          return "conflict";
        }

        const localDirty = localSha256 !== checkpoint.localSha256;
        const remoteChanged =
          (typeof remoteMeta.revision === "number" &&
            remoteMeta.revision !== checkpoint.revision) ||
          Boolean(
            remoteMeta.payloadSha256 &&
              checkpoint.serverSha256 &&
              remoteMeta.payloadSha256 !== checkpoint.serverSha256,
          );

        if (!localDirty && !remoteChanged) {
          state().setCloudSync({
            phase: "synced",
            lastSyncedAt: checkpoint.syncedAt,
            lastCheckedAt: now,
            hasLocalChanges: false,
            remoteMeta,
            conflict: undefined,
            error: undefined,
          });
          if (!options?.manual) void syncHistoryWithCloud(userId, "smart");
          return "noop";
        }

        if (localDirty && !remoteChanged) {
          const pushResult = await pushLocalToCloud(userId, {
            expectedRevision: checkpoint.revision,
            notifyConflict: true,
          });
          if (pushResult === "synced" && !options?.manual) {
            void syncHistoryWithCloud(userId, "smart");
          }
          return pushResult === "synced" ? "pushed" : "conflict";
        }

        const pulled = await cloudSyncNative.pull(TWITCH_CLIENT_ID);
        if (!("bundle" in pulled)) {
          const pushResult = await pushLocalToCloud(userId, { expectedRevision: 0 });
          return pushResult === "synced" ? "pushed" : "conflict";
        }

        if (!localDirty) {
          await applyPulledCloudBundle(userId, pulled.bundle, pulled.meta, false);
          toast.info(i18n.t("profiles.cloud.updatedFromCloudToast"));
          if (!options?.manual) void syncHistoryWithCloud(userId, "smart");
          return "pulled";
        }

        const remoteNormalized = normalizeCloudBundle(pulled.bundle);
        state().setCloudSync({
          phase: "conflict",
          lastCheckedAt: now,
          hasLocalChanges: true,
          remoteMeta: pulled.meta,
          conflict: { remoteMeta: pulled.meta, remoteBundle: remoteNormalized },
          error: undefined,
        });
        toast.warning(i18n.t("profiles.cloud.conflictToast"));
        return "conflict";
      } catch (error) {
        const msg = errorMessage(error);
        cloudSyncLimiter.applyServerRateLimit(msg);
        state().setCloudSync({
          phase: "error",
          cooldownUntil: cloudSyncLimiter.getManualRemainingMs()
            ? Date.now() + cloudSyncLimiter.getManualRemainingMs()
            : state().cloudSync.cooldownUntil,
          error: msg,
        });
        return "skipped";
      } finally {
        cloudSyncInFlightRef.current = false;
      }
    },
    [
      applyPulledCloudBundle,
      buildLocalCloudPayload,
      pushLocalToCloud,
      setCloudSyncCheckpoint,
      state,
    ],
  );

  const refreshProAndSync = useCallback(
    async (userId: string, accountLogin: string) => {
      if (!isTauri()) return;
      const cached = cloudSyncLimiter.getCachedEntitlements(userId);
      if (cached) {
        if (state().twitch.userId !== userId) return;
        state().setEntitlements({ ...cached, loading: false, error: undefined });
        if (cached.pro) {
          await reconcileCloudOnConnect(userId, accountLogin);
        }
        return;
      }
      state().setEntitlements({ loading: true, error: undefined });
      try {
        const entitlements = await proNative.entitlements(TWITCH_CLIENT_ID);
        if (state().twitch.userId !== userId) return;
        cloudSyncLimiter.setCachedEntitlements(userId, entitlements);
        state().setEntitlements({ ...entitlements, loading: false, error: undefined });
        if (entitlements.pro) {
          await reconcileCloudOnConnect(userId, accountLogin);
        }
      } catch (error) {
        if (state().twitch.userId !== userId) return;
        state().setEntitlements({
          loading: false,
          error: errorMessage(error),
        });
      }
    },
    [reconcileCloudOnConnect, state],
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
      void refreshProAndSync(session.userId, session.login);
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
  }, [applyTwitchAccountProfile, ingest, refreshProAndSync, sendCommandReply, state]);

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

  useEffect(() => {
    if (
      !isTauri() ||
      !ready ||
      !proActive ||
      !twitchUserId ||
      applyingProfileRef.current ||
      cloudSyncPhase === "conflict"
    ) {
      return;
    }
    const checkpoint = state().cloudSyncCheckpoints[twitchUserId];
    if (!checkpoint) return;

    window.clearTimeout(cloudPushTimerRef.current);
    const delayMs = cloudSyncEnabled ? 2500 : 1200;
    cloudPushTimerRef.current = window.setTimeout(() => {
      cloudPushTimerRef.current = undefined;
      if (cloudSyncInFlightRef.current || applyingProfileRef.current) return;
      void (async () => {
        const current = state();
        if (
          !current.entitlements.pro ||
          current.twitch.userId !== twitchUserId ||
          current.cloudSync.phase === "conflict"
        ) {
          return;
        }
        const { localSha256 } = await buildLocalCloudPayload();
        const latestCheckpoint = current.cloudSyncCheckpoints[twitchUserId];
        if (!latestCheckpoint) return;

        if (localSha256 === latestCheckpoint.localSha256) {
          if (current.cloudSync.hasLocalChanges || current.cloudSync.phase === "pending") {
            current.setCloudSync({
              phase: "synced",
              hasLocalChanges: false,
              lastSyncedAt: latestCheckpoint.syncedAt,
              error: undefined,
            });
          }
          return;
        }

        if (!current.cloudSyncEnabled) {
          if (current.cloudSync.phase !== "pending" || !current.cloudSync.hasLocalChanges) {
            current.setCloudSync({
              phase: "pending",
              hasLocalChanges: true,
              error: undefined,
            });
          }
          return;
        }

        const rateWait = cloudSyncLimiter.getManualRemainingMs();
        if (rateWait > 0) {
          current.setCloudSync({
            phase: "pending",
            hasLocalChanges: true,
            cooldownUntil: Date.now() + rateWait,
          });
          return;
        }

        cloudSyncInFlightRef.current = true;
        current.setCloudSync({ phase: "syncing", hasLocalChanges: true, error: undefined });
        try {
          await pushLocalToCloud(twitchUserId, {
            expectedRevision: latestCheckpoint.revision,
            notifyConflict: true,
          });
        } catch (error) {
          const msg = errorMessage(error);
          cloudSyncLimiter.applyServerRateLimit(msg);
          state().setCloudSync({
            phase: "error",
            cooldownUntil: cloudSyncLimiter.getManualRemainingMs()
              ? Date.now() + cloudSyncLimiter.getManualRemainingMs()
              : state().cloudSync.cooldownUntil,
            error: msg,
          });
        } finally {
          cloudSyncInFlightRef.current = false;
        }
      })();
    }, delayMs);

    return () => {
      window.clearTimeout(cloudPushTimerRef.current);
    };
  }, [
    ready,
    cloudSyncEnabled,
    proActive,
    twitchUserId,
    profilesList,
    activeProfileId,
    cloudSyncPhase,
    buildLocalCloudPayload,
    pushLocalToCloud,
    state,
  ]);

  const shutdown = useCallback(async () => {
    window.clearTimeout(cloudPushTimerRef.current);
    cloudPushTimerRef.current = undefined;
    const current = state();
    if (current.ready) {
      const { nextProfiles } = buildSyncedProfiles();
      current.setProfiles(nextProfiles);
      await saveLocalState("profiles", nextProfiles).catch(() => undefined);
      if (
        isTauri() &&
        current.cloudSyncEnabled &&
        current.entitlements.pro &&
        current.twitch.userId &&
        current.cloudSync.phase !== "conflict"
      ) {
        const userId = current.twitch.userId;
        const checkpoint = current.cloudSyncCheckpoints[userId];
        if (checkpoint) {
          const { localSha256 } = await buildLocalCloudPayload().catch(() => ({
            localSha256: undefined,
          }));
          if (localSha256 && localSha256 !== checkpoint.localSha256) {
            await pushLocalToCloud(userId, {
              expectedRevision: checkpoint.revision,
            }).catch(() => undefined);
          }
        }
      }
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
  }, [buildLocalCloudPayload, buildSyncedProfiles, pushLocalToCloud, state]);

  const [remoteAuthNeeded, setRemoteAuthNeeded] = useState(false);
  const [remoteTokenInput, setRemoteTokenInput] = useState("");
  const [remoteAuthError, setRemoteAuthError] = useState<string>();

  const sendRemoteAction = async (type: string, payload: Record<string, unknown> = {}) => {
    const token = sessionStorage.getItem("sd_remote_token") ?? "";
    await fetch("/api/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-SD-Token": token } : {}),
      },
      body: JSON.stringify({ type, payload }),
    });
  };

  const applyRemoteSnapshot = useCallback((snap: Record<string, unknown>) => {
    if (!snap || typeof snap !== "object" || snap.ready !== true) return false;
    useAppStore.setState((prev) => ({
      ...prev,
      ready: true,
      ...(snap.settings ? { settings: snap.settings as typeof prev.settings } : {}),
      ...(snap.stats ? { stats: snap.stats as typeof prev.stats } : {}),
      ...(Array.isArray(snap.chatMessages) ? { chatMessages: snap.chatMessages as typeof prev.chatMessages } : {}),
      ...(Array.isArray(snap.events) ? { events: snap.events as typeof prev.events } : {}),
      ...(snap.obs ? { obs: snap.obs as typeof prev.obs } : {}),
      ...(snap.giveaway ? { giveaway: snap.giveaway as typeof prev.giveaway } : {}),
      ...(snap.twitch ? { twitch: snap.twitch as typeof prev.twitch } : {}),
      ...(snap.twitchBot ? { twitchBot: snap.twitchBot as typeof prev.twitchBot } : {}),
      ...(snap.streamElements ? { streamElements: snap.streamElements as typeof prev.streamElements } : {}),
      ...(snap.tipeeStream ? { tipeeStream: snap.tipeeStream as typeof prev.tipeeStream } : {}),
      ...(Array.isArray(snap.commands) ? { commands: snap.commands as typeof prev.commands } : {}),
      ...(Array.isArray(snap.customVariables) ? { customVariables: snap.customVariables as typeof prev.customVariables } : {}),
      ...(snap.chatAlerts ? { chatAlerts: snap.chatAlerts as typeof prev.chatAlerts } : {}),
      ...(Array.isArray(snap.channelRewards) ? { channelRewards: snap.channelRewards as typeof prev.channelRewards } : {}),
      ...(Array.isArray(snap.profiles) ? { profiles: snap.profiles as typeof prev.profiles } : {}),
      ...(typeof snap.activeProfileId === "string" ? { activeProfileId: snap.activeProfileId } : {}),
      ...(typeof snap.lastTwitchUserId === "string" ? { lastTwitchUserId: snap.lastTwitchUserId } : {}),
      ...(typeof snap.profilesAutoSwitch === "boolean" ? { profilesAutoSwitch: snap.profilesAutoSwitch } : {}),
      ...(typeof snap.cloudSyncEnabled === "boolean" ? { cloudSyncEnabled: snap.cloudSyncEnabled } : {}),
      ...(snap.cloudSyncCheckpoints ? { cloudSyncCheckpoints: snap.cloudSyncCheckpoints as typeof prev.cloudSyncCheckpoints } : {}),
      ...(snap.cloudSync ? { cloudSync: snap.cloudSync as typeof prev.cloudSync } : {}),
      ...(snap.supportTicket ? { supportTicket: snap.supportTicket as typeof prev.supportTicket } : {}),
      ...(snap.storageTicket ? { storageTicket: snap.storageTicket as typeof prev.storageTicket } : {}),
      ...(snap.entitlements ? { entitlements: snap.entitlements as typeof prev.entitlements } : {}),
    }));
    return true;
  }, []);

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
        remoteSse = new EventSource(`/api/events${q}`);
        remoteSse.addEventListener("state", (ev) => {
          try {
            applyRemoteSnapshot(JSON.parse(ev.data) as Record<string, unknown>);
          } catch {
            // ignore
          }
        });
      };
      const fetchInitial = async () => {
        if (disposed) return;
        try {
          const q = token ? `?token=${encodeURIComponent(token)}` : "";
          const res = await fetch(`/api/state${q}`);
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
          rawCloudSyncEnabled,
          rawCloudSyncCheckpoints,
          events,
          chatMessages,
        } = await loadBootstrap();
        if (disposed) return;
        state().setCloudSyncEnabled(
          typeof rawCloudSyncEnabled === "boolean" ? rawCloudSyncEnabled : true,
        );
    if (rawCloudSyncCheckpoints && typeof rawCloudSyncCheckpoints === "object") {
      const checkpoints = rawCloudSyncCheckpoints as Record<string, CloudSyncUserCheckpoint>;
      state().setCloudSyncCheckpoints(checkpoints);
      const lastUid = typeof rawLastTwitchUserId === "string" ? rawLastTwitchUserId : undefined;
      const lastCp = lastUid ? checkpoints[lastUid] : undefined;
      if (lastCp) {
        state().setCloudSync({
          phase: "synced",
          lastSyncedAt: lastCp.syncedAt,
          lastCheckedAt: lastCp.lastCheckedAt,
          hasLocalChanges: false,
        });
      }
    }
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
              } else if (actionType === "state.save" && typeof data.key === "string") {
                const key = data.key;
                const val = data.value;
                void saveLocalState(key, val);
                if (key === "commands" && Array.isArray(val)) state().setCommands(val as never);
                else if (key === "customVariables" && Array.isArray(val)) state().setCustomVariables(val as never);
                else if (key === "chatAlerts" && val && typeof val === "object") state().setChatAlerts(val as never);
                else if (key === "channelRewards" && Array.isArray(val)) state().setChannelRewards(val as never);
                else if (key === "giveaway" && val && typeof val === "object") state().setGiveaway(val as never);
                else if (key === "profiles" && Array.isArray(val)) state().setProfiles(val as never);
                else if (key === "activeProfileId" && typeof val === "string") state().setActiveProfileId(val);
                else if (key in state().settings) state().setSettings({ [key]: val } as never);
              } else if (actionType === "state.saveBatch" && data.entries && typeof data.entries === "object") {
                const entries = data.entries as Record<string, unknown>;
                void saveLocalStateBatch(entries);
                const settingsPatch: Record<string, unknown> = {};
                for (const [key, val] of Object.entries(entries)) {
                  if (key === "commands" && Array.isArray(val)) state().setCommands(val as never);
                  else if (key === "customVariables" && Array.isArray(val)) state().setCustomVariables(val as never);
                  else if (key === "chatAlerts" && val && typeof val === "object") state().setChatAlerts(val as never);
                  else if (key === "channelRewards" && Array.isArray(val)) state().setChannelRewards(val as never);
                  else if (key === "giveaway" && val && typeof val === "object") state().setGiveaway(val as never);
                  else if (key === "profiles" && Array.isArray(val)) state().setProfiles(val as never);
                  else if (key === "activeProfileId" && typeof val === "string") state().setActiveProfileId(val);
                  else if (key in state().settings) settingsPatch[key] = val;
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
  }, [applyRemoteSnapshot, reconnect, setChatMessages, setEvents, setReady, setSettings, state]);

  useEffect(() => {
    if (!isTauri()) return;
    let timer: number | undefined;
    const publish = () => {
      const s = useAppStore.getState();
      if (!s.ready) return;
      void webHostNative.publishState({
        ready: true,
        settings: s.settings,
        stats: s.stats,
        chatMessages: s.chatMessages.slice(-100),
        events: s.events.slice(0, 200),
        obs: s.obs,
        giveaway: s.giveaway,
        twitch: s.twitch,
        twitchBot: s.twitchBot,
        streamElements: s.streamElements,
        tipeeStream: s.tipeeStream,
        commands: s.commands,
        customVariables: s.customVariables,
        chatAlerts: s.chatAlerts,
        channelRewards: s.channelRewards,
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        lastTwitchUserId: s.lastTwitchUserId,
        profilesAutoSwitch: s.profilesAutoSwitch,
        cloudSyncEnabled: s.cloudSyncEnabled,
        cloudSyncCheckpoints: s.cloudSyncCheckpoints,
        cloudSync: s.cloudSync,
        supportTicket: s.supportTicket,
        storageTicket: s.storageTicket,
        entitlements: s.entitlements,
      });
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
    cloudSyncLimiter.invalidateEntitlements();
    state().setTwitch({ phase: "disconnected" });
    state().setCloudSync({
      phase: "idle",
      remoteMeta: undefined,
      conflict: undefined,
      error: undefined,
      lastSyncedAt: undefined,
      lastCheckedAt: undefined,
      cooldownUntil: undefined,
      hasLocalChanges: undefined,
    });
    state().setEntitlements({ tier: "free", pro: false, features: [] });
    state().setSupportTicket(undefined);
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
  const sendChatMessage = async (text: string) => {
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

  const setCloudSyncEnabledPref = async (enabled: boolean) => {
    const current = state();
    current.setCloudSyncEnabled(enabled);
    await saveLocalState("cloudSyncEnabled", enabled);
    if (!enabled) {
      window.clearTimeout(cloudPushTimerRef.current);
      cloudPushTimerRef.current = undefined;
      return;
    }
    if (current.twitch.userId && current.twitch.account) {
      await reconcileCloudOnConnect(current.twitch.userId, current.twitch.account);
    }
  };

  const syncCloudNow = async (
    mode: "smart" | "push" | "pull" = "smart",
    options?: { force?: boolean; merge?: boolean },
  ) => {
    const current = state();
    const userId = current.twitch.userId;
    const account = current.twitch.account ?? "";
    if (!isTauri() || !userId) {
      throw new Error(i18n.t("stream.notConnected"));
    }
    if (cloudSyncInFlightRef.current) return;

    const allowDuringCooldown =
      current.cloudSync.phase === "conflict" || Boolean(options?.force);
    const gate = cloudSyncLimiter.canRunManualAction(allowDuringCooldown);
    if (!gate.allowed) {
      const waitSeconds = Math.max(1, Math.ceil(gate.waitMs / 1000));
      current.setCloudSync({ cooldownUntil: Date.now() + gate.waitMs });
      toast.info(i18n.t("profiles.cloud.rateLimited", { seconds: waitSeconds }));
      return;
    }

    cloudSyncInFlightRef.current = true;
    current.setCloudSync({ phase: "syncing", error: undefined });
    try {
      if (mode === "smart") {
        cloudSyncInFlightRef.current = false;
        const outcome = await reconcileCloudOnConnect(userId, account, {
          force: true,
          manual: true,
        });
        const until = cloudSyncLimiter.recordManualOutcome({
          serverWork: outcome === "pushed" || outcome === "pulled",
        });
        state().setCloudSync({ cooldownUntil: until });
        if (outcome === "noop") {
          await syncHistoryWithCloud(userId, "smart");
          toast.info(i18n.t("profiles.cloud.alreadyUpToDate"));
        } else if (outcome === "pushed" || outcome === "pulled") {
          await syncHistoryWithCloud(userId, "smart");
          toast.success(i18n.t("profiles.cloud.syncSuccess"));
        }
        return;
      }

      if (mode === "push") {
        const checkpoint = state().cloudSyncCheckpoints[userId];
        if (!options?.force && checkpoint) {
          const { localSha256 } = await buildLocalCloudPayload();
          if (localSha256 === checkpoint.localSha256) {
            const now = Date.now();
            const recentMeta = state().cloudSync.remoteMeta;
            const recentlyChecked =
              recentMeta &&
              recentMeta.exists &&
              typeof state().cloudSync.lastCheckedAt === "number" &&
              now - (state().cloudSync.lastCheckedAt ?? 0) < 15_000;
            const remoteMeta = recentlyChecked
              ? recentMeta
              : await cloudSyncNative.meta(TWITCH_CLIENT_ID);

            if (remoteMeta.proRequired) {
              cloudSyncLimiter.invalidateEntitlements(userId);
              state().setEntitlements({ tier: "free", pro: false, features: [], license: undefined });
              state().setCloudSync({ phase: "idle", error: undefined });
              toast.info(i18n.t("pro.requiredToast"));
              return;
            }

            if (
              remoteMeta.exists &&
              remoteMeta.revision === checkpoint.revision &&
              (!remoteMeta.payloadSha256 ||
                !checkpoint.serverSha256 ||
                remoteMeta.payloadSha256 === checkpoint.serverSha256)
            ) {
              const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
              state().setCloudSync({
                phase: "synced",
                lastSyncedAt: checkpoint.syncedAt,
                lastCheckedAt: now,
                hasLocalChanges: false,
                cooldownUntil: until,
                remoteMeta,
                conflict: undefined,
                error: undefined,
              });
              toast.info(i18n.t("profiles.cloud.alreadyUpToDate"));
              return;
            }

            if (remoteMeta.exists) {
              cloudSyncInFlightRef.current = false;
              await reconcileCloudOnConnect(userId, account, { force: true, manual: true });
              const until = cloudSyncLimiter.recordManualOutcome({ serverWork: true });
              state().setCloudSync({ cooldownUntil: until });
              return;
            }
          }
        }

        const status = await pushLocalToCloud(userId, {
          expectedRevision: options?.force ? undefined : checkpoint?.revision,
          force: options?.force,
          notifyConflict: true,
        });
        const until = cloudSyncLimiter.recordManualOutcome({
          serverWork: status === "synced",
        });
        state().setCloudSync({ cooldownUntil: until });
        if (status === "synced") {
          await syncHistoryWithCloud(userId, "push");
          toast.success(i18n.t("profiles.cloud.uploadSuccess"));
        }
        return;
      }

      if (!options?.merge && current.cloudSync.phase !== "conflict") {
        const remoteMeta = await cloudSyncNative.meta(TWITCH_CLIENT_ID);
        const now = Date.now();
        if (remoteMeta.proRequired) {
          cloudSyncLimiter.invalidateEntitlements(userId);
          const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
          state().setEntitlements({ tier: "free", pro: false, features: [], license: undefined });
          state().setCloudSync({ phase: "idle", cooldownUntil: until, error: undefined });
          toast.info(i18n.t("pro.requiredToast"));
          return;
        }
        if (!remoteMeta.exists) {
          const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
          state().setCloudSync({
            phase: "idle",
            lastCheckedAt: now,
            cooldownUntil: until,
            remoteMeta: { exists: false },
            conflict: undefined,
            error: undefined,
          });
          toast.info(i18n.t("profiles.cloud.noRemoteBackup"));
          return;
        }
        const checkpoint = state().cloudSyncCheckpoints[userId];
        if (checkpoint && remoteMeta.revision === checkpoint.revision) {
          const { localSha256 } = await buildLocalCloudPayload();
          if (localSha256 === checkpoint.localSha256) {
            const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
            state().setCloudSync({
              phase: "synced",
              lastSyncedAt: checkpoint.syncedAt,
              lastCheckedAt: now,
              hasLocalChanges: false,
              cooldownUntil: until,
              remoteMeta,
              conflict: undefined,
              error: undefined,
            });
            toast.info(i18n.t("profiles.cloud.alreadyUpToDate"));
            return;
          }
        }
      }

      const pulled = await cloudSyncNative.pull(TWITCH_CLIENT_ID);
      if ("proRequired" in pulled && pulled.proRequired) {
        cloudSyncLimiter.invalidateEntitlements(userId);
        const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
        state().setEntitlements({ tier: "free", pro: false, features: [], license: undefined });
        state().setCloudSync({ phase: "idle", cooldownUntil: until, error: undefined });
        toast.info(i18n.t("pro.requiredToast"));
        return;
      }
      if (!("bundle" in pulled)) {
        const until = cloudSyncLimiter.recordManualOutcome({ serverWork: false });
        state().setCloudSync({
          phase: "idle",
          cooldownUntil: until,
          remoteMeta: { exists: false },
          conflict: undefined,
          error: undefined,
        });
        toast.info(i18n.t("profiles.cloud.noRemoteBackup"));
        return;
      }
      await applyPulledCloudBundle(
        userId,
        pulled.bundle,
        pulled.meta,
        Boolean(options?.merge),
      );
      await syncHistoryWithCloud(userId, "pull");
      const until = cloudSyncLimiter.recordManualOutcome({ serverWork: true });
      state().setCloudSync({ cooldownUntil: until });
      toast.success(i18n.t("profiles.cloud.downloadSuccess"));
    } catch (error) {
      const rawMsg = errorMessage(error);
      const waitSeconds = cloudSyncLimiter.applyServerRateLimit(rawMsg);
      const displayMsg = waitSeconds
        ? i18n.t("profiles.cloud.rateLimited", { seconds: waitSeconds })
        : rawMsg;
      state().setCloudSync({
        phase: "error",
        cooldownUntil: cloudSyncLimiter.getManualRemainingMs()
          ? Date.now() + cloudSyncLimiter.getManualRemainingMs()
          : state().cloudSync.cooldownUntil,
        error: displayMsg,
      });
      toast.error(i18n.t("profiles.cloud.syncError"), { description: displayMsg });
      throw error;
    } finally {
      cloudSyncInFlightRef.current = false;
    }
  };

  const deleteCloudBackup = async () => {
    const current = state();
    const userId = current.twitch.userId;
    if (!isTauri() || !userId) {
      throw new Error(i18n.t("stream.notConnected"));
    }
    if (cloudSyncInFlightRef.current) return;
    const gate = cloudSyncLimiter.canRunManualAction(false);
    if (!gate.allowed) {
      const waitSeconds = Math.max(1, Math.ceil(gate.waitMs / 1000));
      current.setCloudSync({ cooldownUntil: Date.now() + gate.waitMs });
      toast.info(i18n.t("profiles.cloud.rateLimited", { seconds: waitSeconds }));
      return;
    }
    cloudSyncInFlightRef.current = true;
    current.setCloudSync({ phase: "syncing", error: undefined });
    try {
      await cloudSyncNative.remove(TWITCH_CLIENT_ID);
      await setCloudSyncCheckpoint(userId, undefined);
      const until = cloudSyncLimiter.recordManualOutcome({ serverWork: true });
      current.setCloudSync({
        phase: "idle",
        lastSyncedAt: undefined,
        lastCheckedAt: Date.now(),
        hasLocalChanges: undefined,
        cooldownUntil: until,
        remoteMeta: { exists: false },
        conflict: undefined,
        error: undefined,
      });
      toast.success(i18n.t("profiles.cloud.deleteSuccess"));
    } catch (error) {
      const rawMsg = errorMessage(error);
      const waitSeconds = cloudSyncLimiter.applyServerRateLimit(rawMsg);
      const displayMsg = waitSeconds
        ? i18n.t("profiles.cloud.rateLimited", { seconds: waitSeconds })
        : rawMsg;
      current.setCloudSync({
        phase: "error",
        cooldownUntil: cloudSyncLimiter.getManualRemainingMs()
          ? Date.now() + cloudSyncLimiter.getManualRemainingMs()
          : current.cloudSync.cooldownUntil,
        error: displayMsg,
      });
      toast.error(i18n.t("profiles.cloud.syncError"), { description: displayMsg });
      throw error;
    } finally {
      cloudSyncInFlightRef.current = false;
    }
  };

  const refreshProEntitlements = async () => {
    const current = state();
    if (!isTauri()) {
      void sendRemoteAction("pro.refresh");
      return current.entitlements;
    }
    const userId = current.twitch.userId;
    if (!userId) {
      const freeState = { tier: "free" as const, pro: false, features: [] };
      current.setEntitlements(freeState);
      return freeState;
    }
    current.setEntitlements({ loading: true, error: undefined });
    try {
      const entitlements = await proNative.entitlements(TWITCH_CLIENT_ID);
      cloudSyncLimiter.setCachedEntitlements(userId, entitlements);
      state().setEntitlements({ ...entitlements, loading: false, error: undefined });
      return entitlements;
    } catch (error) {
      const msg = errorMessage(error);
      state().setEntitlements({ loading: false, error: msg });
      throw error;
    }
  };

  const activateProLicense = async (licenseKey: string) => {
    const current = state();
    const userId = current.twitch.userId;
    const account = current.twitch.account ?? "";
    if (!isTauri() || !userId) {
      throw new Error(i18n.t("stream.notConnected"));
    }
    const gate = cloudSyncLimiter.canActivatePro();
    if (!gate.allowed) {
      throw new Error(`rate_limited:${gate.waitSeconds}`);
    }
    cloudSyncLimiter.recordProActivateAttempt();
    try {
      const result = await proNative.activate(TWITCH_CLIENT_ID, licenseKey.trim());
      cloudSyncLimiter.setCachedEntitlements(userId, result.entitlements);
      state().setEntitlements({ ...result.entitlements, loading: false, error: undefined });
      toast.success(
        i18n.t("pro.activatedToast", { account }),
      );
      if (result.entitlements.pro && state().cloudSyncEnabled) {
        void reconcileCloudOnConnect(userId, account, { force: true });
      }
      return result.entitlements;
    } catch (error) {
      const waitSeconds = parseRateLimitWaitSeconds(errorMessage(error));
      if (waitSeconds) {
        cloudSyncLimiter.applyServerRateLimit(`rate_limited:${waitSeconds}`);
      }
      throw error;
    }
  };

  const refreshSupportTicket = async (force = false) => {
    const current = state();
    if (!isTauri()) return current.supportTicket;
    const userId = current.twitch.userId;
    if (!userId) {
      current.setSupportTicket(undefined);
      return undefined;
    }
    const gate = cloudSyncLimiter.canFetchSupportTicket(userId, force);
    if (!gate.allowed) {
      if (force && gate.waitSeconds > 0) {
        toast.info(i18n.t("settings.support.refreshRateLimited", { seconds: gate.waitSeconds }));
      }
      return current.supportTicket;
    }
    current.setSupportTicket({ loading: true, error: undefined });
    try {
      const next = await supportNative.ticketStatus(TWITCH_CLIENT_ID);
      if (state().twitch.userId !== userId) return undefined;
      cloudSyncLimiter.markSupportTicketFetched(userId, force);
      state().setSupportTicket({ ...next, loading: false, error: undefined });

      // If admin approved a reset while app was open, immediately sync entitlements + clear cloud lock!
      const wasPro = state().entitlements.pro;
      if (wasPro && !next.hasActiveLicense) {
        cloudSyncLimiter.invalidateEntitlements(userId);
        state().setEntitlements({
          tier: "free",
          pro: false,
          twitchUserId: userId,
          twitchLogin: state().twitch.account,
          features: [],
          license: undefined,
          loading: false,
          error: undefined,
        });
        state().setCloudSync({
          phase: "idle",
          error: undefined,
          hasLocalChanges: undefined,
        });
        if (next.latestTicket?.status === "approved") {
          toast.success(i18n.t("settings.support.approvedToast"));
        }
      }
      return next;
    } catch (error) {
      const msg = errorMessage(error);
      cloudSyncLimiter.applyServerRateLimit(msg);
      state().setSupportTicket({ loading: false, error: msg });
      if (force) {
        toast.error(i18n.t("settings.support.loadError"), { description: msg });
      }
      return undefined;
    }
  };

  const submitKeyResetTicket = async (message: string) => {
    const current = state();
    const userId = current.twitch.userId;
    if (!isTauri() || !userId) {
      throw new Error(i18n.t("stream.notConnected"));
    }
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      throw new Error("message_too_short");
    }
    await supportNative.submitKeyReset(TWITCH_CLIENT_ID, trimmed);
    cloudSyncLimiter.markSupportTicketFetched(userId, true);
    const updated = await supportNative.ticketStatus(TWITCH_CLIENT_ID);
    state().setSupportTicket({ ...updated, loading: false, error: undefined });
    toast.success(i18n.t("settings.support.submitSuccess"));
  };

  const refreshStorageTicket = async (force = false) => {
    const current = state();
    if (!isTauri()) return current.storageTicket;
    const userId = current.twitch.userId;
    if (!userId) {
      current.setStorageTicket(undefined);
      return undefined;
    }
    current.setStorageTicket({ loading: true, error: undefined });
    try {
      const next = await supportNative.storageStatus(TWITCH_CLIENT_ID);
      if (state().twitch.userId !== userId) return undefined;
      state().setStorageTicket({ ...next, loading: false, error: undefined });
      state().setCloudSync({ storageInfo: next.storage });
      return next;
    } catch (error) {
      const msg = errorMessage(error);
      state().setStorageTicket({ loading: false, error: msg });
      if (force) {
        toast.error(i18n.t("profiles.cloud.storage.loadError"), { description: msg });
      }
      return undefined;
    }
  };

  const submitStorageRequestTicket = async (requestedMb: number, message: string) => {
    const current = state();
    const userId = current.twitch.userId;
    if (!isTauri() || !userId) {
      throw new Error(i18n.t("stream.notConnected"));
    }
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      throw new Error("message_too_short");
    }
    await supportNative.submitStorageRequest(TWITCH_CLIENT_ID, requestedMb, trimmed);
    const updated = await supportNative.storageStatus(TWITCH_CLIENT_ID);
    state().setStorageTicket({ ...updated, loading: false, error: undefined });
    state().setCloudSync({ storageInfo: updated.storage });
    toast.success(i18n.t("profiles.cloud.storage.requestSuccess"));
  };

  if (!isTauri() && remoteAuthNeeded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4 text-ink">
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
    <RuntimeContext.Provider
      value={{
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
        setCloudSyncEnabled: setCloudSyncEnabledPref,
        syncCloudNow,
        deleteCloudBackup,
        refreshProEntitlements,
        activateProLicense,
        refreshSupportTicket,
        submitKeyResetTicket,
        refreshStorageTicket,
        submitStorageRequestTicket,
        reconnect,
        shutdown,
      }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}
