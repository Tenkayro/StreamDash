export type ActivitySource = 'twitch' | 'streamelements' | 'tipeeestream'
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

export type ObsInputKind = 'mic' | 'desktop'
export interface ObsAudioInput {
  name: string
  kind: ObsInputKind
  muted: boolean
  volume: number
  volumeDb: number
}

export interface ObsSnapshot {
  version?: string
  profile?: string
  sceneCollection?: string
  scene?: string
  scenes: string[]
  streaming: boolean
  streamSeconds: number
  streamBitrate?: number
  streamDropped?: number
  recording: boolean
  recordingPaused: boolean
  recordingSeconds: number
  replayBuffer: boolean
  virtualCam: boolean
  fps?: number
  cpu?: number
  audio: ObsAudioInput[]
  updatedAt: number
}

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

export type DashboardWidgetId = 'followers' | 'subscribers' | 'viewers' | 'duration' | 'bits' | 'donations' | 'status' | 'eventCount' | 'activity' | 'streamDetails' | 'livePreview' | 'goals' | 'connections' | 'obs'
export type DashboardItemId = DashboardWidgetId | `browser:${string}`
export type DashboardWidgetWidth = 'single' | 'wide' | 'full'
export interface DashboardWidgetDimensions { width: DashboardWidgetWidth; height: number }
export interface DashboardBrowserSource { id: string; name: string; url: string }
export type UiDensity = 'compact' | 'comfortable'
export type ContentWidth = 'compact' | 'wide' | 'full'
export type AccentColor = 'violet' | 'blue' | 'emerald' | 'orange'
export type AppLanguage = 'auto' | 'en' | 'de' | 'es' | 'pt-BR' | 'fr'
export type TrayStyle = 'custom' | 'classic'
export type GoalMetric = 'followers' | 'subscribers' | 'donations' | 'bits' | 'raids' | 'giftSubscriptions'
export interface GoalAutomation { enabled: boolean; increasePercent: number }

export interface AppSettings {
  onboardingCompleted: boolean
  language: AppLanguage
  launchAtStartup: boolean
  keepUserData: boolean
  minimizeToTray: boolean
  trayStyle: TrayStyle
  compactFeed: boolean
  animations: boolean
  uiDensity: UiDensity
  contentWidth: ContentWidth
  accentColor: AccentColor
  sidebarCollapsed: boolean
  dashboardWidgets: DashboardItemId[]
  dashboardWidgetDimensions: Partial<Record<DashboardItemId, DashboardWidgetDimensions>>
  dashboardBrowserSources: DashboardBrowserSource[]
  dashboardZoom: number
  dashboardLayoutVersion: number
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
  obsAddress: string
  obsEnabled: boolean
  notifications: boolean
  notifyDonations: boolean
  notifyRaids: boolean
  notifyGiftSubs: boolean
  maximumEvents: number
  disabledEventTypes: ActivityType[]
  goals: Partial<Record<GoalMetric, number>>
  goalAutomation: Partial<Record<GoalMetric, GoalAutomation>>
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
