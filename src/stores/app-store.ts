import { create } from 'zustand'
import type { ActivityEvent, AppSettings, ConnectionState, DashboardStats } from '../types'

export const defaultSettings: AppSettings = {
  launchAtStartup: false, minimizeToTray: true, compactFeed: false, animations: true,
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
  stats: DashboardStats; setStats: (stats: Partial<DashboardStats>) => void
  settings: AppSettings; setSettings: (settings: Partial<AppSettings>) => void
}
export const useAppStore = create<AppStore>((set) => ({
  page: 'dashboard', setPage: (page) => set({ page }), ready: false, setReady: (ready) => set({ ready }),
  events: [], setEvents: (events) => set({ events }), pushEvent: (event) => set((s) => s.events.some((e) => e.id === event.id) ? s : { events: [event, ...s.events].slice(0, s.settings.maximumEvents) }), clearEvents: () => set({ events: [] }),
  twitch: { phase: 'disconnected' }, setTwitch: (twitch) => set({ twitch }),
  streamElements: { phase: 'disconnected' }, setStreamElements: (streamElements) => set({ streamElements }),
  stats: emptyStats, setStats: (stats) => set((s) => ({ stats: { ...s.stats, ...stats } })),
  settings: defaultSettings, setSettings: (settings) => set((s) => ({ settings: { ...s.settings, ...settings } })),
}))
