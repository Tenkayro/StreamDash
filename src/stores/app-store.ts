import type { SearchTarget } from "../lib/search";
import { create } from "zustand";
import { withPageTransition } from "../lib/page-transition";
import {
  defaultChatAlerts,
  defaultCommands,
  defaultCustomVariables,
  defaultDashboardWidgets,
  defaultSettings,
  emptyStats,
  initialGiveaway,
} from "../lib/defaults";
import type {
  ActivityEvent,
  AppSettings,
  ChannelPointReward,
  ChatAlertsConfig,
  ChatCommand,
  ChatEmote,
  ChatMessage,
  CloudSyncState,
  CloudSyncUserCheckpoint,
  ConnectionState,
  CustomVariable,
  DashboardStats,
  GiveawayEntry,
  GiveawayState,
  ObsSnapshot,
  ProEntitlements,
  UserProfile,
} from "../types";
import {
  clearChatMessages,
  saveLocalState,
  updateChatMessage,
} from "../services/native";

export {
  defaultChatAlerts,
  defaultCommands,
  defaultCustomVariables,
  defaultDashboardWidgets,
  defaultSettings,
  emptyStats,
  initialGiveaway,
};
interface AppStore {
  searchTarget?: SearchTarget;
  setSearchTarget: (target?: SearchTarget) => void;
  page: string;
  pageHistory: string[];
  pageHistoryIndex: number;
  setPage: (page: string) => void;
  goBack: () => void;
  goForward: () => void;
  ready: boolean;
  setReady: (ready: boolean) => void;
  unreadCounts: Record<string, number>;
  incrementUnread: (id: string) => void;
  markPageRead: (id: string) => void;
  events: ActivityEvent[];
  setEvents: (events: ActivityEvent[]) => void;
  pushEvent: (event: ActivityEvent) => void;
  clearEvents: () => void;
  twitch: ConnectionState;
  setTwitch: (state: ConnectionState) => void;
  twitchBot: ConnectionState;
  setTwitchBot: (state: ConnectionState) => void;
  streamElements: ConnectionState;
  setStreamElements: (state: ConnectionState) => void;
  tipeeStream: ConnectionState;
  setTipeeeStream: (state: ConnectionState) => void;
  obs: ConnectionState;
  setObs: (state: ConnectionState) => void;
  obsSnapshot?: ObsSnapshot;
  setObsSnapshot: (snapshot?: ObsSnapshot) => void;
  chat: ConnectionState;
  setChat: (state: ConnectionState) => void;
  chatEmotes: ChatEmote[];
  setChatEmotes: (emotes: ChatEmote[]) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (messages: ChatMessage[]) => void;
  pushChatMessage: (message: ChatMessage) => void;
  removeChatMessage: (id: string) => void;
  clearChat: (login?: string) => void;
  stats: DashboardStats;
  statsLoading: boolean;
  setStatsLoading: (loading: boolean) => void;
  setStats: (stats: Partial<DashboardStats>) => void;
  settings: AppSettings;
  setSettings: (settings: Partial<AppSettings>) => void;
  giveaway: GiveawayState;
  setGiveaway: (patch: Partial<GiveawayState>) => void;
  ingestGiveawayChatMessage: (message: ChatMessage, botLogin?: string) => void;
  removeGiveawayEntry: (login: string) => void;
  clearGiveawayEntries: () => void;
  pruneInactiveGiveawayEntries: (now?: number) => void;
  commands: ChatCommand[];
  setCommands: (commands: ChatCommand[]) => void;
  upsertCommand: (command: ChatCommand) => void;
  deleteCommand: (id: string) => void;
  toggleCommand: (id: string, enabled: boolean) => void;
  incrementCommandUsage: (id: string) => number;
  channelRewards: ChannelPointReward[];
  setChannelRewards: (rewards: ChannelPointReward[]) => void;
  upsertChannelReward: (reward: ChannelPointReward) => void;
  deleteChannelReward: (id: string) => void;
  chatAlerts: ChatAlertsConfig;
  setChatAlerts: (patch: Partial<ChatAlertsConfig>) => void;
  customVariables: CustomVariable[];
  setCustomVariables: (vars: CustomVariable[]) => void;
  upsertCustomVariable: (variable: CustomVariable) => void;
  deleteCustomVariable: (id: string) => void;
  adjustCustomCounter: (id: string, delta: number, reset?: boolean) => void;
  profiles: UserProfile[];
  setProfiles: (profiles: UserProfile[]) => void;
  activeProfileId: string;
  setActiveProfileId: (id: string) => void;
  lastTwitchUserId?: string;
  setLastTwitchUserId: (id?: string) => void;
  profilesAutoSwitch: boolean;
  setProfilesAutoSwitch: (enabled: boolean) => void;
  cloudSyncEnabled: boolean;
  setCloudSyncEnabled: (enabled: boolean) => void;
  cloudSyncCheckpoints: Record<string, CloudSyncUserCheckpoint>;
  setCloudSyncCheckpoints: (
    checkpoints: Record<string, CloudSyncUserCheckpoint>,
  ) => void;
  cloudSync: CloudSyncState;
  setCloudSync: (patch: Partial<CloudSyncState>) => void;
  entitlements: ProEntitlements;
  setEntitlements: (patch: Partial<ProEntitlements> | ProEntitlements) => void;
}
export const useAppStore = create<AppStore>((set) => ({
  searchTarget: undefined,
  setSearchTarget: (searchTarget) => set({ searchTarget }),
  page: "dashboard",
  pageHistory: ["dashboard"],
  pageHistoryIndex: 0,
  setPage: (page) => {
    const current = useAppStore.getState();
    if (page === current.page) return;
    withPageTransition(
      () =>
        set((s) => {
          if (page === s.page) return s;
          const history = [
            ...s.pageHistory.slice(0, s.pageHistoryIndex + 1),
            page,
          ].slice(-50);
          return {
            page,
            pageHistory: history,
            pageHistoryIndex: history.length - 1,
            unreadCounts: { ...s.unreadCounts, [page]: 0 },
          };
        }),
      current.settings.animations,
    );
  },
  goBack: () => {
    const current = useAppStore.getState();
    if (current.pageHistoryIndex <= 0) return;
    withPageTransition(
      () =>
        set((s) => {
          if (s.pageHistoryIndex <= 0) return s;
          const index = s.pageHistoryIndex - 1;
          return { page: s.pageHistory[index], pageHistoryIndex: index };
        }),
      current.settings.animations,
    );
  },
  goForward: () => {
    const current = useAppStore.getState();
    if (current.pageHistoryIndex >= current.pageHistory.length - 1) return;
    withPageTransition(
      () =>
        set((s) => {
          if (s.pageHistoryIndex >= s.pageHistory.length - 1) return s;
          const index = s.pageHistoryIndex + 1;
          return { page: s.pageHistory[index], pageHistoryIndex: index };
        }),
      current.settings.animations,
    );
  },
  ready: false,
  setReady: (ready) => set({ ready }),
  unreadCounts: {},
  incrementUnread: (id) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [id]: (s.unreadCounts[id] ?? 0) + 1 },
    })),
  markPageRead: (id) =>
    set((s) => ({ unreadCounts: { ...s.unreadCounts, [id]: 0 } })),
  events: [],
  setEvents: (events) => set({ events }),
  pushEvent: (event) =>
    set((s) => {
      const counts = { ...s.unreadCounts };
      if (s.page !== "activitys") {
        counts.activitys = (counts.activitys ?? 0) + 1;
      }
      return {
        events: [event, ...s.events].slice(0, s.settings.maximumEvents),
        unreadCounts: counts,
      };
    }),
  clearEvents: () =>
    set((s) => {
      const nextStats = {
        ...s.stats,
        bits: 0,
        donations: 0,
        donationCurrency: undefined,
      };
      if (s.ready) void saveLocalState("cachedStats", nextStats).catch(() => undefined);
      return { events: [], stats: nextStats };
    }),
  twitch: { phase: "disconnected" },
  setTwitch: (twitch) => set({ twitch }),
  twitchBot: { phase: "disconnected" },
  setTwitchBot: (twitchBot) => set({ twitchBot }),
  streamElements: { phase: "disconnected" },
  setStreamElements: (streamElements) => set({ streamElements }),
  tipeeStream: { phase: "disconnected" },
  setTipeeeStream: (tipeeStream) => set({ tipeeStream }),
  obs: { phase: "disconnected" },
  setObs: (obs) => set({ obs }),
  obsSnapshot: undefined,
  setObsSnapshot: (obsSnapshot) => set({ obsSnapshot }),
  chat: { phase: "disconnected" },
  setChat: (chat) => set({ chat }),
  chatEmotes: [],
  setChatEmotes: (chatEmotes) => set({ chatEmotes }),
  chatMessages: [],
  setChatMessages: (chatMessages) => set({ chatMessages }),
  pushChatMessage: (message) =>
    set((s) => {
      if (s.chatMessages.some((item) => item.id === message.id)) return s;
      const withoutEcho = message.id.startsWith("local-")
        ? s.chatMessages
        : s.chatMessages.filter(
            (item) =>
              !(
                item.id.startsWith("local-") &&
                item.login === message.login &&
                item.text === message.text &&
                message.timestamp - item.timestamp < 15_000
              ),
          );
      return {
        chatMessages: [...withoutEcho, message].slice(
          -s.settings.maximumChatMessages,
        ),
        unreadCounts: s.page !== "chat"
          ? { ...s.unreadCounts, chat: (s.unreadCounts.chat ?? 0) + 1 }
          : s.unreadCounts,
      };
    }),
  removeChatMessage: (id) => {
    void updateChatMessage({ id, deleted: true }).catch(() => undefined);
    set((s) => ({
      chatMessages: s.chatMessages.map((message) =>
        message.id === id ? { ...message, deleted: true } : message,
      ),
    }));
  },
  clearChat: (login) => {
    if (login) void updateChatMessage({ login, deleted: true }).catch(() => undefined);
    else void clearChatMessages().catch(() => undefined);
    set((s) => ({
      chatMessages: login
        ? s.chatMessages.map((message) =>
            message.login === login ? { ...message, deleted: true } : message,
          )
        : [],
    }));
  },
  stats: emptyStats,
  statsLoading: false,
  setStatsLoading: (statsLoading) => set({ statsLoading }),
  setStats: (stats) =>
    set((s) => {
      const nextStats = { ...s.stats, ...stats };
      if (s.ready) {
        void saveLocalState("cachedStats", nextStats).catch(() => undefined);
      }
      return { stats: nextStats };
    }),
  settings: defaultSettings,
  setSettings: (settings) =>
    set((s) => ({ settings: { ...s.settings, ...settings } })),
  giveaway: initialGiveaway,
  setGiveaway: (patch) =>
    set((s) => {
      const nextGiveaway = { ...s.giveaway, ...patch };
      if (s.ready) {
        void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
      }
      return { giveaway: nextGiveaway };
    }),
  ingestGiveawayChatMessage: (message, botLogin) =>
    set((s) => {
      if (!s.giveaway.running || message.deleted) return s;
      const login = message.login.toLowerCase();
      if (botLogin && login === botLogin.toLowerCase()) return s;
      if (s.giveaway.disqualifiedUsers.includes(login)) return s;
      const subscriber = message.badges.some(
        (badge) => badge.id === "subscriber" || badge.id === "founder",
      );
      const phrase = s.giveaway.keyword.trim().toLocaleLowerCase();
      const matchesKeyword =
        s.giveaway.type === "active" ||
        (Boolean(phrase) &&
          message.text.toLocaleLowerCase().includes(phrase));
      const existingIndex = s.giveaway.entries.findIndex(
        (entry) => entry.login === login,
      );
      if (existingIndex !== -1) {
        const existing = s.giveaway.entries[existingIndex];
        const nextKeywordCount = matchesKeyword
          ? existing.keywordCount + 1
          : existing.keywordCount;
        if (
          matchesKeyword &&
          s.giveaway.antiSpamLimit >= 2 &&
          nextKeywordCount >= s.giveaway.antiSpamLimit
        ) {
          const nextGiveaway = {
            ...s.giveaway,
            entries: s.giveaway.entries.filter((entry) => entry.login !== login),
            disqualifiedUsers: [...s.giveaway.disqualifiedUsers, login],
          };
          if (s.ready) {
            void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
          }
          return { giveaway: nextGiveaway };
        }
        const updatedEntries = [...s.giveaway.entries];
        updatedEntries[existingIndex] = {
          ...existing,
          displayName: message.displayName,
          color: message.color,
          badges: message.badges,
          subscriber,
          lastActiveAt: message.timestamp,
          keywordCount: nextKeywordCount,
        };
        const nextGiveaway = { ...s.giveaway, entries: updatedEntries };
        if (s.ready) {
          void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
        }
        return { giveaway: nextGiveaway };
      }
      if (!matchesKeyword) return s;
      const nextEntry: GiveawayEntry = {
        login,
        displayName: message.displayName,
        color: message.color,
        badges: message.badges,
        subscriber,
        enteredAt: message.timestamp,
        lastActiveAt: message.timestamp,
        keywordCount: 1,
      };
      const nextGiveaway = {
        ...s.giveaway,
        entries: [...s.giveaway.entries, nextEntry],
      };
      if (s.ready) {
        void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
      }
      return { giveaway: nextGiveaway };
    }),
  removeGiveawayEntry: (login) =>
    set((s) => {
      const target = login.toLowerCase();
      const nextGiveaway = {
        ...s.giveaway,
        entries: s.giveaway.entries.filter((entry) => entry.login !== target),
      };
      if (s.ready) {
        void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
      }
      return { giveaway: nextGiveaway };
    }),
  clearGiveawayEntries: () =>
    set((s) => {
      const nextGiveaway = {
        ...s.giveaway,
        entries: [],
        disqualifiedUsers: [],
        winner: undefined,
      };
      if (s.ready) {
        void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
      }
      return { giveaway: nextGiveaway };
    }),
  pruneInactiveGiveawayEntries: (now = Date.now()) =>
    set((s) => {
      const timeoutSeconds = s.giveaway.inactivityTimeout;
      if (!s.giveaway.running || timeoutSeconds <= 0 || !s.giveaway.entries.length)
        return s;
      const cutoff = now - timeoutSeconds * 1000;
      const filtered = s.giveaway.entries.filter(
        (entry) => entry.lastActiveAt >= cutoff,
      );
      if (filtered.length === s.giveaway.entries.length) return s;
      const nextGiveaway = { ...s.giveaway, entries: filtered };
      if (s.ready) {
        void saveLocalState("giveaway", nextGiveaway).catch(() => undefined);
      }
      return { giveaway: nextGiveaway };
    }),
  commands: defaultCommands,
  setCommands: (commands) =>
    set(() => {
      const hasBuiltIn = commands.some((cmd) => cmd.id === "builtin-song");
      const merged = hasBuiltIn ? commands : [...defaultCommands, ...commands];
      return { commands: merged };
    }),
  upsertCommand: (command) =>
    set((s) => {
      const exists = s.commands.some((item) => item.id === command.id);
      const nextCommands = exists
        ? s.commands.map((item) => (item.id === command.id ? command : item))
        : [...s.commands, command];
      if (s.ready) {
        void saveLocalState("commands", nextCommands).catch(() => undefined);
      }
      return { commands: nextCommands };
    }),
  deleteCommand: (id) =>
    set((s) => {
      const nextCommands = s.commands.filter(
        (item) => item.id !== id || item.builtIn,
      );
      if (s.ready) {
        void saveLocalState("commands", nextCommands).catch(() => undefined);
      }
      return { commands: nextCommands };
    }),
  toggleCommand: (id, enabled) =>
    set((s) => {
      const nextCommands = s.commands.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      );
      if (s.ready) {
        void saveLocalState("commands", nextCommands).catch(() => undefined);
      }
      return { commands: nextCommands };
    }),
  incrementCommandUsage: (id) => {
    let nextCount = 1;
    set((s) => {
      const nextCommands = s.commands.map((item) => {
        if (item.id !== id) return item;
        nextCount = (item.usageCount ?? 0) + 1;
        return { ...item, usageCount: nextCount };
      });
      if (s.ready) {
        void saveLocalState("commands", nextCommands).catch(() => undefined);
      }
      return { commands: nextCommands };
    });
    return nextCount;
  },
  channelRewards: [],
  setChannelRewards: (channelRewards) =>
    set((s) => {
      if (s.ready) {
        void saveLocalState("channelRewards", channelRewards).catch(
          () => undefined,
        );
      }
      return { channelRewards };
    }),
  upsertChannelReward: (reward) =>
    set((s) => {
      const exists = s.channelRewards.some((item) => item.id === reward.id);
      const nextRewards = exists
        ? s.channelRewards.map((item) => (item.id === reward.id ? reward : item))
        : [reward, ...s.channelRewards];
      if (s.ready) {
        void saveLocalState("channelRewards", nextRewards).catch(
          () => undefined,
        );
      }
      return { channelRewards: nextRewards };
    }),
  deleteChannelReward: (id) =>
    set((s) => {
      const nextRewards = s.channelRewards.filter((item) => item.id !== id);
      if (s.ready) {
        void saveLocalState("channelRewards", nextRewards).catch(
          () => undefined,
        );
      }
      return { channelRewards: nextRewards };
    }),
  chatAlerts: defaultChatAlerts,
  setChatAlerts: (patch) =>
    set((s) => {
      const nextAlerts = { ...s.chatAlerts, ...patch };
      if (s.ready) {
        void saveLocalState("chatAlerts", nextAlerts).catch(() => undefined);
      }
      return { chatAlerts: nextAlerts };
    }),
  customVariables: defaultCustomVariables,
  setCustomVariables: (customVariables) => set({ customVariables }),
  upsertCustomVariable: (variable) =>
    set((s) => {
      const cleanName = variable.name
        .trim()
        .replace(/^\$\(|\)$|^\{|\}$/g, "")
        .replace(/^custom\./i, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "")
        .toLowerCase();
      if (!cleanName) return s;
      const normalized: CustomVariable = {
        ...variable,
        name: cleanName,
        updatedAt: Date.now(),
      };
      const exists = s.customVariables.some(
        (item) => item.id === normalized.id || item.name === cleanName,
      );
      const nextVariables = exists
        ? s.customVariables.map((item) =>
            item.id === normalized.id || item.name === cleanName
              ? { ...normalized, id: item.id }
              : item,
          )
        : [...s.customVariables, normalized];
      if (s.ready) {
        void saveLocalState("customVariables", nextVariables).catch(
          () => undefined,
        );
      }
      return { customVariables: nextVariables };
    }),
  deleteCustomVariable: (id) =>
    set((s) => {
      const nextVariables = s.customVariables.filter((item) => item.id !== id);
      if (s.ready) {
        void saveLocalState("customVariables", nextVariables).catch(
          () => undefined,
        );
      }
      return { customVariables: nextVariables };
    }),
  adjustCustomCounter: (id, delta, reset = false) =>
    set((s) => {
      const nextVariables = s.customVariables.map((item) => {
        if (item.id !== id) return item;
        const currentNum = Number.parseInt(item.value, 10) || 0;
        const nextNum = reset ? 0 : currentNum + delta;
        return {
          ...item,
          type: "counter" as const,
          value: String(nextNum),
          updatedAt: Date.now(),
        };
      });
      if (s.ready) {
        void saveLocalState("customVariables", nextVariables).catch(
          () => undefined,
        );
      }
      return { customVariables: nextVariables };
    }),
  profiles: [],
  setProfiles: (profiles) => set({ profiles }),
  activeProfileId: "default",
  setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
  lastTwitchUserId: undefined,
  setLastTwitchUserId: (lastTwitchUserId) => set({ lastTwitchUserId }),
  profilesAutoSwitch: true,
  setProfilesAutoSwitch: (profilesAutoSwitch) => set({ profilesAutoSwitch }),
  cloudSyncEnabled: true,
  setCloudSyncEnabled: (cloudSyncEnabled) => set({ cloudSyncEnabled }),
  cloudSyncCheckpoints: {},
  setCloudSyncCheckpoints: (cloudSyncCheckpoints) => set({ cloudSyncCheckpoints }),
  cloudSync: { phase: "idle" },
  setCloudSync: (patch) =>
    set((s) => ({ cloudSync: { ...s.cloudSync, ...patch } })),
  entitlements: { tier: "free", pro: false, features: [] },
  setEntitlements: (patch) =>
    set((s) => ({
      entitlements:
        "tier" in patch && patch.tier
          ? { ...(patch as ProEntitlements) }
          : { ...s.entitlements, ...patch },
    })),
}));
