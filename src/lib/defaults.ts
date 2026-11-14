import type {
  AppSettings,
  ChatAlertsConfig,
  ChatCommand,
  CustomVariable,
  DashboardItemId,
  DashboardStats,
  GiveawayState,
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
  "activitys",
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
  companion: {
    language: "system",
    keepScreenOn: true,
    autoReconnect: true,
    notificationsEnabled: true,
    notifyFollows: true,
    notifySubs: true,
    notifyRaids: true,
    notifyCheers: true,
    notifyDonations: true,
    notifyChannelPoints: false,
    notifyStreamStatus: true,
    notifyChatMentions: true,
    hapticsEnabled: true,
    hapticStrength: "strong",
  },
};

export const emptyStats: DashboardStats = {
  bits: 0,
  donations: 0,
  live: false,
};

export const initialGiveaway: GiveawayState = {
  running: false,
  chatAnnouncements: true,
  type: "keyword",
  keyword: "!enter",
  antiSpamLimit: 0,
  inactivityTimeout: 0,
  subscriberLuck: 1,
  entries: [],
  disqualifiedUsers: [],
  winner: undefined,
};

export const defaultCommands: ChatCommand[] = [
  {
    id: "builtin-song",
    name: "song",
    usePrefix: true,
    enabled: true,
    builtIn: true,
    response: "{song}",
    globalCooldown: 5,
    perUserCooldown: 15,
    responseType: "reply",
    aliases: ["currentsong", "music"],
    keywords: [],
    enabledWhenOffline: true,
    enabledWhenOnline: true,
    hiddenFromPublic: false,
    whisperOnCooldown: false,
    roles: [],
    games: [],
    titleKeywords: [],
    useRelativeTime: true,
    expiryAction: "none",
    expiresInSeconds: 600,
    createdAt: 0,
  },
];

export const defaultChatAlerts: ChatAlertsConfig = {
  subTier1: {
    enabled: false,
    message: "$(user) just subscribed! PogChamp",
  },
  subTier2: {
    enabled: false,
    message: "$(user) just subscribed with Tier 2! PogChamp",
  },
  subTier3: {
    enabled: false,
    message: "$(user) just subscribed with Tier 3! PogChamp",
  },
  subPrime: {
    enabled: false,
    message: "$(user) just subscribed with Prime Gaming! PogChamp",
  },
  resubTier1: {
    enabled: false,
    message: "$(user) just resubscribed for $(months) months! PogChamp",
  },
  resubTier2: {
    enabled: false,
    message:
      "$(user) just resubscribed for $(months) months with Tier 2! PogChamp",
  },
  resubTier3: {
    enabled: false,
    message:
      "$(user) just resubscribed for $(months) months with Tier 3! PogChamp",
  },
  resubPrime: {
    enabled: false,
    message:
      "$(user) just resubscribed for $(months) months with Prime Gaming! PogChamp",
  },
  giftTier1: {
    enabled: false,
    message: "$(user) just gifted a sub to $(recipient)! bleedPurple",
  },
  giftTier2: {
    enabled: false,
    message: "$(user) just gifted a Tier 2 sub to $(recipient)! bleedPurple",
  },
  giftTier3: {
    enabled: false,
    message: "$(user) just gifted a Tier 3 sub to $(recipient)! bleedPurple",
  },
  massGiftTier1: {
    enabled: false,
    message: "$(user) just gifted $(amount) subs! PogChamp",
  },
  massGiftTier2: {
    enabled: false,
    message: "$(user) just gifted $(amount) Tier 2 subs! PogChamp",
  },
  massGiftTier3: {
    enabled: false,
    message: "$(user) just gifted $(amount) Tier 3 subs! PogChamp",
  },
  raid: {
    enabled: false,
    message: "$(user) is raiding the stream with $(viewers) viewers! TombRaid",
    minimum: 5,
  },
  bits: {
    enabled: false,
    message: "$(user) just cheered $(bits) bits! PogChamp",
    minimum: 100,
  },
  donation: {
    enabled: false,
    message: "$(user) just donated $(amount)! Thank you so much! PogChamp",
    minimum: 1,
  },
  follower: {
    enabled: false,
    message: "$(user) just followed the stream! bleedPurple",
  },
  channelPoint: {
    enabled: false,
    message: "$(user) redeemed $(title)! bleedPurple",
  },
  goLive: {
    enabled: false,
    message:
      "$(channel.display_name) just went live! They're playing $(game)! PogChamp",
  },
  goOffline: {
    enabled: false,
    message: "$(channel.display_name) just went offline. Thanks for watching!",
  },
  gameChange: {
    enabled: false,
    message: "$(channel.display_name) changed their game to $(game)! PogChamp",
  },
  titleChange: {
    enabled: false,
    message:
      '$(channel.display_name) changed their title to "$(title)"! PogChamp',
  },
};

export const defaultCustomVariables: CustomVariable[] = [
  {
    id: "var-deaths",
    name: "deaths",
    type: "counter",
    value: "0",
    updatedAt: 0,
  },
  {
    id: "var-wins",
    name: "wins",
    type: "counter",
    value: "0",
    updatedAt: 0,
  },
];
