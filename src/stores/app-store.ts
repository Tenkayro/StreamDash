import { create } from 'zustand'
import type { ActivityEvent, AppSettings, ChatMessage, ConnectionState, DashboardStats, DashboardWidgetId } from '../types'

export const defaultDashboardWidgets: DashboardWidgetId[] = ['followers', 'subscribers', 'viewers', 'duration', 'bits', 'donations', 'status', 'eventCount', 'activity', 'streamDetails']

export const defaultSettings: AppSettings = {
  twitchClientId: import.meta.env.VITE_TWITCH_CLIENT_ID?.trim() || '',
  launchAtStartup: false, keepUserData: true, minimizeToTray: true, compactFeed: false, animations: true,
  uiDensity: 'compact', contentWidth: 'wide', accentColor: 'violet', sidebarCollapsed: false,
  dashboardWidgets: defaultDashboardWidgets,
  notifications: true, notifyDonations: true, notifyRaids: true, notifyGiftSubs: true,
  maximumEvents: 5000, disabledEventTypes: [], goals: {},
}
const emptyStats: DashboardStats = { bits: 0, donations: 0, live: false }
interface AppStore {
  page: string; setPage: (page: string) => void
  ready: boolean; setReady: (ready: boolean) => void
  events: ActivityEvent[]; setEvents: (events: ActivityEvent[]) => void; pushEvent: (event: ActivityEvent) => void; clearEvents: () => void
  twitch: ConnectionState; setTwitch: (state: ConnectionState) => void
  streamElements: ConnectionState; setStreamElements: (state: ConnectionState) => void
  chat: ConnectionState; setChat: (state: ConnectionState) => void
  chatMessages: ChatMessage[]; pushChatMessage: (message: ChatMessage) => void; removeChatMessage: (id: string) => void; clearChat: (login?: string) => void
  stats: DashboardStats; setStats: (stats: Partial<DashboardStats>) => void
  settings: AppSettings; setSettings: (settings: Partial<AppSettings>) => void
}
export const useAppStore = create<AppStore>((set) => ({
  page: 'dashboard', setPage: (page) => set({ page }), ready: false, setReady: (ready) => set({ ready }),
  events: [], setEvents: (events) => set({ events }), pushEvent: (event) => set((s) => s.events.some((e) => e.id === event.id) ? s : { events: [event, ...s.events].slice(0, s.settings.maximumEvents) }), clearEvents: () => set({ events: [] }),
  twitch: { phase: 'disconnected' }, setTwitch: (twitch) => set({ twitch }),
  streamElements: { phase: 'disconnected' }, setStreamElements: (streamElements) => set({ streamElements }),
  chat: { phase: 'disconnected' }, setChat: (chat) => set({ chat }),
  chatMessages: [], pushChatMessage: (message) => set((s) => s.chatMessages.some((item) => item.id === message.id) ? s : ({ chatMessages: [...s.chatMessages, message].slice(-400) })),
  removeChatMessage: (id) => set((s) => ({ chatMessages: s.chatMessages.filter((message) => message.id !== id) })),
  clearChat: (login) => set((s) => ({ chatMessages: login ? s.chatMessages.filter((message) => message.login !== login) : [] })),
  stats: emptyStats, setStats: (stats) => set((s) => ({ stats: { ...s.stats, ...stats } })),
  settings: defaultSettings, setSettings: (settings) => set((s) => ({ settings: { ...s.settings, ...settings } })),
}))
