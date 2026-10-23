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
export interface ConnectionState { phase: ConnectionPhase; account?: string; userId?: string; scopes?: string[]; detail?: string }

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

export type DashboardWidgetId = 'followers' | 'subscribers' | 'viewers' | 'duration' | 'bits' | 'donations' | 'status' | 'eventCount' | 'activity' | 'streamDetails' | 'goals' | 'connections'
export type UiDensity = 'compact' | 'comfortable'
export type ContentWidth = 'compact' | 'wide' | 'full'
export type AccentColor = 'violet' | 'blue' | 'emerald' | 'orange'

export interface AppSettings {
  twitchClientId: string
  launchAtStartup: boolean
  keepUserData: boolean
  minimizeToTray: boolean
  compactFeed: boolean
  animations: boolean
  uiDensity: UiDensity
  contentWidth: ContentWidth
  accentColor: AccentColor
  sidebarCollapsed: boolean
  dashboardWidgets: DashboardWidgetId[]
  chatTimestamps: boolean
  chatBadges: boolean
  chatHighlightMentions: boolean
  chatHighlightWords: string[]
  chatFontSize: number
  chatEmoteSize: number
  maximumChatMessages: number
  chatHiddenUsers: string[]
  chatHighlightIgnoredUsers: string[]
  chatUserNotes: Record<string, string>
  notifications: boolean
  notifyDonations: boolean
  notifyRaids: boolean
  notifyGiftSubs: boolean
  maximumEvents: number
  disabledEventTypes: ActivityType[]
  goals: { followers?: number; subscribers?: number; donations?: number }
}

export interface TwitchSession { userId: string; login: string; scopes: string[]; expiresIn: number }

export interface ChatBadge { id: string; version: string; url?: string }
export interface ChatEmote { name: string; url: string; zeroWidth: boolean; source: '7tv' | 'twitch' }
export type ChatPart = { type: 'text'; text: string } | { type: 'emote'; layers: Array<{ name: string; url: string }> }
export interface ChatMessage {
  id: string
  login: string
  displayName: string
  color: string
  badges: ChatBadge[]
  timestamp: number
  text: string
  parts: ChatPart[]
  firstMessage?: boolean
  action?: boolean
  reply?: { displayName: string; body: string }
  deleted?: boolean
}

export interface ChatUserProfile {
  id: string
  login: string
  displayName: string
  avatarUrl?: string
  createdAt?: string
  followedAt?: string
  banned: boolean
  bannedUntil?: string
  banReason?: string
  moderator: boolean
  vip: boolean
}
