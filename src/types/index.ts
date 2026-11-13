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

export type DashboardWidgetId =
  | 'followers'
  | 'subscribers'
  | 'viewers'
  | 'duration'
  | 'bits'
  | 'donations'
  | 'status'
  | 'eventCount'
  | 'raids'
  | 'giftSubs'
  | 'chatActivity'
  | 'giveawayCount'
  | 'activitys'
  | 'streamDetails'
  | 'livePreview'
  | 'goals'
  | 'connections'
  | 'obs'
  | 'chat'
  | 'quickActions'
  | 'giveaway'
  | 'commands'
  | 'channelPoints'
  | 'customCounters'
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
  donationToolDoneIds: string[]
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

export type GiveawayType = 'keyword' | 'active'

export interface GiveawayEntry {
  login: string
  displayName: string
  color: string
  badges: ChatBadge[]
  subscriber: boolean
  enteredAt: number
  lastActiveAt: number
  keywordCount: number
}

export interface GiveawayState {
  running: boolean
  chatAnnouncements: boolean
  type: GiveawayType
  keyword: string
  antiSpamLimit: number
  inactivityTimeout: number
  subscriberLuck: number
  entries: GiveawayEntry[]
  disqualifiedUsers: string[]
  winner?: GiveawayEntry
}

export type CommandResponseType = 'say' | 'mention' | 'reply' | 'whisper'
export type CommandRole = 'broadcaster' | 'moderator' | 'vip' | 'founder' | 'subscriber' | 'non_subscriber'
export type CommandExpiryAction = 'none' | 'disable' | 'delete'

export interface ChatCommand {
  id: string
  name: string
  usePrefix: boolean
  enabled: boolean
  builtIn?: boolean
  response: string
  globalCooldown: number
  perUserCooldown: number
  responseType: CommandResponseType
  aliases: string[]
  keywords: string[]
  enabledWhenOffline: boolean
  enabledWhenOnline: boolean
  hiddenFromPublic: boolean
  whisperOnCooldown: boolean
  roles: CommandRole[]
  games: string[]
  titleKeywords: string[]
  useRelativeTime: boolean
  expiryAction: CommandExpiryAction
  expiresInSeconds: number
  expiresAt?: number
  usageCount?: number
  createdAt: number
}

export type CustomVariableType = 'text' | 'counter'

export interface CustomVariable {
  id: string
  name: string
  type: CustomVariableType
  value: string
  updatedAt: number
}

export interface ChannelPointReward {
  id: string
  title: string
  prompt: string
  cost: number
  backgroundColor: string
  enabled: boolean
  paused: boolean
  enabledWhenOffline: boolean
  enabledWhenOnline: boolean
  userInputRequired: boolean
  skipRequestQueue: boolean
  maxPerStreamEnabled: boolean
  maxPerStream: number
  maxPerUserPerStreamEnabled: boolean
  maxPerUserPerStream: number
  globalCooldownEnabled: boolean
  globalCooldownSeconds: number
  imageUrl?: string
  manageable?: boolean
}

export interface ChatAlertItem {
  enabled: boolean
  message: string
}

export interface ChatAlertThresholdItem extends ChatAlertItem {
  minimum: number
}

export interface ChatAlertsConfig {
  subTier1: ChatAlertItem
  subTier2: ChatAlertItem
  subTier3: ChatAlertItem
  subPrime: ChatAlertItem
  resubTier1: ChatAlertItem
  resubTier2: ChatAlertItem
  resubTier3: ChatAlertItem
  resubPrime: ChatAlertItem
  giftTier1: ChatAlertItem
  giftTier2: ChatAlertItem
  giftTier3: ChatAlertItem
  massGiftTier1: ChatAlertItem
  massGiftTier2: ChatAlertItem
  massGiftTier3: ChatAlertItem
  raid: ChatAlertThresholdItem
  bits: ChatAlertThresholdItem
  donation: ChatAlertThresholdItem
  follower: ChatAlertItem
  channelPoint: ChatAlertItem
  goLive: ChatAlertItem
  goOffline: ChatAlertItem
  gameChange: ChatAlertItem
  titleChange: ChatAlertItem
}

export interface ProfileConfigSnapshot {
  settings: AppSettings
  commands: ChatCommand[]
  chatAlerts: ChatAlertsConfig
  customVariables: CustomVariable[]
  channelRewards: ChannelPointReward[]
  giveaway: GiveawayState
  cachedStats: Partial<DashboardStats>
}

export interface UserProfile {
  id: string
  name: string
  twitchUserId?: string
  twitchLogin?: string
  createdAt: number
  updatedAt: number
  data: ProfileConfigSnapshot
}

export interface ProfileExportSections {
  appearance: boolean
  dashboard: boolean
  chatAndObs: boolean
  automation: boolean
  history: boolean
}

export interface ProfileExportBundle {
  format: 'streamdash-backup'
  version: 1
  exportedAt: string
  appVersion?: string
  scope: 'profile' | 'all'
  included: ProfileExportSections
  activeProfileId?: string
  profiles: UserProfile[]
  events?: ActivityEvent[]
  chatMessages?: ChatMessage[]
}

export interface ProLicenseInfo {
  keyId?: string
  maskedKey: string
  variantName?: string
  activatedAt: number
  lastCheckedAt?: number
}

export interface ProEntitlements {
  tier: 'free' | 'pro'
  pro: boolean
  twitchUserId?: string
  twitchLogin?: string
  features: string[]
  license?: ProLicenseInfo
  loading?: boolean
  error?: string
}

export interface CloudSyncRemoteMeta {
  exists: boolean
  proRequired?: boolean
  twitchUserId?: string
  twitchLogin?: string
  schemaVersion?: number
  revision?: number
  updatedAt?: number
  serverUpdatedAt?: number
  payloadSha256?: string
  rawBytes?: number
  profileCount?: number
}

export interface CloudSyncUserCheckpoint {
  revision: number
  localSha256: string
  serverSha256?: string
  syncedAt: number
  lastCheckedAt?: number
  serverUpdatedAt?: number
  rawBytes?: number
  profileCount?: number
}

export interface CloudSyncConflict {
  remoteMeta: CloudSyncRemoteMeta
  remoteBundle?: ProfileExportBundle
}

export interface StorageQuotaInfo {
  usedBytes: number
  quotaBytes: number
  customQuotaBytes?: number | null
  defaultQuotaBytes: number
  effectiveDefaultQuotaBytes: number
  globalUsedBytes: number
  globalPoolMaxBytes: number
  globalSoftThrottled: boolean
  globalPoolFull: boolean
  historyRevision: number
  historyUpdatedAt: number
  historyEventCount?: number
}

export interface StorageQuotaTicket {
  id: number
  twitchUserId: string
  twitchLogin: string
  usedBytes: number
  currentQuotaBytes: number
  requestedMb: number
  grantedMb?: number | null
  userMessage: string
  status: 'pending' | 'approved' | 'rejected'
  adminNote?: string
  decidedBy?: string
  createdAt: number
  decidedAt?: number | null
  updatedAt: number
}

export interface StorageTicketState {
  storage: StorageQuotaInfo
  canSubmit: boolean
  blockedReason?: 'ticket_already_pending' | 'support_cooldown' | 'max_quota_reached'
  cooldownUntil?: number
  latestTicket?: StorageQuotaTicket | null
  loading?: boolean
  error?: string
}

export interface CloudSyncState {
  phase: 'idle' | 'syncing' | 'pending' | 'synced' | 'conflict' | 'error'
  lastSyncedAt?: number
  lastCheckedAt?: number
  cooldownUntil?: number
  hasLocalChanges?: boolean
  remoteMeta?: CloudSyncRemoteMeta
  conflict?: CloudSyncConflict
  error?: string
  storageInfo?: StorageQuotaInfo
  historyLastSyncedAt?: number
  historyError?: string
}

export interface SupportResetTicket {
  id: number
  twitchUserId: string
  twitchLogin: string
  keyId?: string
  licenseMasked: string
  userMessage: string
  status: 'pending' | 'approved' | 'rejected'
  adminNote?: string
  decidedBy?: string
  createdAt: number
  decidedAt?: number
  updatedAt: number
}

export interface SupportTicketState {
  hasActiveLicense: boolean
  keyId?: string
  licenseMasked?: string
  resetsUsed: number
  maxResets: number
  resetsRemaining: number
  canSubmit: boolean
  blockedReason?:
    | 'no_active_license'
    | 'key_reset_limit_reached'
    | 'ticket_already_pending'
    | 'support_cooldown'
  cooldownUntil?: number
  latestTicket?: SupportResetTicket | null
  loading?: boolean
  error?: string
}
