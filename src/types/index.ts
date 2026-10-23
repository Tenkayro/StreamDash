export type ActivitySource = 'twitch' | 'streamelements'
export type ActivityType = 'follow' | 'subscription' | 'resubscription' | 'gift_subscription' | 'community_gift' | 'cheer' | 'raid' | 'donation' | 'channel_point' | 'stream_online' | 'stream_offline' | 'other'

export interface ActivityEvent {
  id: string
  source: ActivitySource
  eventType: ActivityType
  username?: string
  displayName?: string
  timestamp: string
  amount?: number
  currency?: string
  message?: string
  tier?: string
  giftCount?: number
  bits?: number
  viewerCount?: number
  metadata: Record<string, unknown>
}

export type ConnectionPhase = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'expired' | 'error'
export interface ConnectionState { phase: ConnectionPhase; account?: string; detail?: string }

export interface DashboardStats {
  followers?: number
  subscribers?: number
  viewers?: number
  bits: number
  donations: number
  donationCurrency?: string
  live: boolean
  startedAt?: string
  title?: string
  category?: string
}

export interface AppSettings {
  launchAtStartup: boolean
  minimizeToTray: boolean
  compactFeed: boolean
  animations: boolean
  notifications: boolean
  notifyDonations: boolean
  notifyRaids: boolean
  notifyGiftSubs: boolean
  maximumEvents: number
  disabledEventTypes: ActivityType[]
  goals: { followers?: number; subscribers?: number; donations?: number }
}

export interface TwitchSession { userId: string; login: string; scopes: string[]; expiresIn: number }
