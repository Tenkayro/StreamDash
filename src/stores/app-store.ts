import type { SearchTarget } from "../lib/search";
import { create } from "zustand";
import { withPageTransition } from "../lib/page-transition";
import type {
  ActivityEvent,
  AppSettings,
  ChatEmote,
  ChatMessage,
  ConnectionState,
  DashboardStats,
  DashboardItemId,
  ObsSnapshot,
} from "../types";

export const defaultDashboardWidgets: DashboardItemId[] = [
  "followers",
  "subscribers",
  "viewers",
  "duration",
  "bits",
  "donations",
  "status",
  "eventCount",
  "activity",
  "streamDetails",
];

export const defaultSettings: AppSettings = {
  onboardingCompleted: false,
  language: "auto",
  launchAtStartup: false,
  keepUserData: true,
  minimizeToTray: true,
  trayStyle: "custom",
  compactFeed: false,
  animations: true,
  uiDensity: "compact",
  contentWidth: "wide",
  accentColor: "orange",
  sidebarCollapsed: false,
  dashboardWidgets: defaultDashboardWidgets,
  dashboardWidgetDimensions: {},
  dashboardBrowserSources: [],
  dashboardZoom: 100,
  dashboardLayoutVersion: 5,
  chatTimestamps: true,
  chatBadges: true,
  chatHighlightMentions: true,
  chatHighlightWords: [],
  chatFontSize: 13,
  chatEmoteSize: 28,
  maximumChatMessages: 1000,
  chatHiddenUsers: [],
  chatHighlightIgnoredUsers: [],
  chatUserNotes: {},
  obsAddress: "127.0.0.1:4455",
  obsEnabled: false,
  notifications: true,
  notifyDonations: true,
  notifyRaids: true,
  notifyGiftSubs: true,
  maximumEvents: 5000,
  disabledEventTypes: [],
  donationToolDoneIds: [],
  goals: {},
  goalAutomation: {},
};
const emptyStats: DashboardStats = { bits: 0, donations: 0, live: false };
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
  pushChatMessage: (message: ChatMessage) => void;
  removeChatMessage: (id: string) => void;
  clearChat: (login?: string) => void;
  stats: DashboardStats;
  statsLoading: boolean;
  setStatsLoading: (loading: boolean) => void;
  setStats: (stats: Partial<DashboardStats>) => void;
  settings: AppSettings;
  setSettings: (settings: Partial<AppSettings>) => void;
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
      if (s.page !== "donations" && event.eventType === "donation") {
        counts.donations = (counts.donations ?? 0) + 1;
      }
      if (s.page !== "activity") {
        counts.activity = (counts.activity ?? 0) + 1;
      }
      return {
        events: [event, ...s.events].slice(0, s.settings.maximumEvents),
        unreadCounts: counts,
      };
    }),
  clearEvents: () => set({ events: [] }),
  twitch: { phase: "disconnected" },
  setTwitch: (twitch) => set({ twitch }),
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
  removeChatMessage: (id) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((message) =>
        message.id === id ? { ...message, deleted: true } : message,
      ),
    })),
  clearChat: (login) =>
    set((s) => ({
      chatMessages: login
        ? s.chatMessages.map((message) =>
            message.login === login ? { ...message, deleted: true } : message,
          )
        : [],
    })),
  stats: emptyStats,
  statsLoading: false,
  setStatsLoading: (statsLoading) => set({ statsLoading }),
  setStats: (stats) => set((s) => ({ stats: { ...s.stats, ...stats } })),
  settings: defaultSettings,
  setSettings: (settings) =>
    set((s) => ({ settings: { ...s.settings, ...settings } })),
}));
