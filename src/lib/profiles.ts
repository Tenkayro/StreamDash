import {
  defaultChatAlerts,
  defaultCommands,
  defaultCustomVariables,
  defaultSettings,
  emptyStats,
  initialGiveaway,
} from "./defaults";
import type {
  ActivityEvent,
  AppSettings,
  ChannelPointReward,
  ChatAlertsConfig,
  ChatCommand,
  ChatMessage,
  CustomVariable,
  DashboardStats,
  GiveawayState,
  ProfileConfigSnapshot,
  ProfileExportBundle,
  ProfileExportSections,
  TwitchSession,
  UserProfile,
} from "../types";

export const DEFAULT_PROFILE_ID = "default";

const APPEARANCE_KEYS = [
  "onboardingCompleted",
  "language",
  "launchAtStartup",
  "keepUserData",
  "minimizeToTray",
  "trayStyle",
  "uiDensity",
  "contentWidth",
  "accentColor",
  "sidebarCollapsed",
  "compactFeed",
  "animations",
  "notifications",
  "notifyDonations",
  "notifyRaids",
  "notifyGiftSubs",
  "maximumEvents",
  "disabledEventTypes",
] as const;

const DASHBOARD_KEYS = [
  "dashboardWidgets",
  "dashboardWidgetDimensions",
  "dashboardBrowserSources",
  "dashboardZoom",
  "dashboardLayoutVersion",
] as const;

const CHAT_AND_OBS_KEYS = [
  "chatTimestamps",
  "chatBadges",
  "chatHighlightMentions",
  "chatHighlightWords",
  "chatFontSize",
  "chatEmoteSize",
  "maximumChatMessages",
  "chatHiddenUsers",
  "chatHighlightIgnoredUsers",
  "chatUserNotes",
  "obsAddress",
  "obsEnabled",
] as const;

const AUTOMATION_SETTINGS_KEYS = [
  "goals",
  "goalAutomation",
  "donationToolDoneIds",
] as const;

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createProfileId(prefix = "profile"): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}:${random}-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSettings(raw?: Partial<AppSettings>): AppSettings {
  const incoming = isRecord(raw) ? raw : {};
  const merged = {
    ...cloneJson(defaultSettings),
    ...cloneJson(incoming as Partial<AppSettings>),
  };
  merged.dashboardWidgets = Array.isArray(merged.dashboardWidgets)
    ? merged.dashboardWidgets
    : [...defaultSettings.dashboardWidgets];
  merged.dashboardWidgetDimensions = isRecord(merged.dashboardWidgetDimensions)
    ? merged.dashboardWidgetDimensions
    : {};
  merged.dashboardBrowserSources = Array.isArray(merged.dashboardBrowserSources)
    ? merged.dashboardBrowserSources
    : [];
  merged.chatHighlightWords = Array.isArray(merged.chatHighlightWords)
    ? merged.chatHighlightWords
    : [];
  merged.chatHiddenUsers = Array.isArray(merged.chatHiddenUsers)
    ? merged.chatHiddenUsers
    : [];
  merged.chatHighlightIgnoredUsers = Array.isArray(merged.chatHighlightIgnoredUsers)
    ? merged.chatHighlightIgnoredUsers
    : [];
  merged.chatUserNotes = isRecord(merged.chatUserNotes)
    ? merged.chatUserNotes
    : {};
  merged.disabledEventTypes = Array.isArray(merged.disabledEventTypes)
    ? merged.disabledEventTypes
    : [];
  merged.donationToolDoneIds = Array.isArray(merged.donationToolDoneIds)
    ? merged.donationToolDoneIds
    : [];
  merged.goals = isRecord(merged.goals) ? merged.goals : {};
  merged.goalAutomation = isRecord(merged.goalAutomation)
    ? merged.goalAutomation
    : {};
  return merged;
}

export function normalizeCommands(raw?: unknown): ChatCommand[] {
  const list = Array.isArray(raw) ? (cloneJson(raw) as ChatCommand[]) : [];
  const hasBuiltIn = list.some((cmd) => cmd?.id === "builtin-song");
  return hasBuiltIn ? list : [...cloneJson(defaultCommands), ...list];
}

export function normalizeChatAlerts(raw?: unknown): ChatAlertsConfig {
  const base = cloneJson(defaultChatAlerts);
  if (!isRecord(raw)) return base;
  const target = base as unknown as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(base)) {
    const incoming = raw[key];
    if (isRecord(incoming)) {
      target[key] = { ...target[key], ...cloneJson(incoming) };
    }
  }
  return base;
}

export function normalizeGiveaway(raw?: unknown): GiveawayState {
  const base = cloneJson(initialGiveaway);
  if (!isRecord(raw)) return base;
  return {
    ...base,
    ...(raw as Partial<GiveawayState>),
    running: Boolean(raw.running),
    entries: Array.isArray(raw.entries)
      ? cloneJson(raw.entries as GiveawayState["entries"])
      : [],
    disqualifiedUsers: Array.isArray(raw.disqualifiedUsers)
      ? cloneJson(raw.disqualifiedUsers as string[])
      : [],
  };
}

export function normalizeProfileSnapshot(
  raw?: Partial<ProfileConfigSnapshot> | null,
): ProfileConfigSnapshot {
  const source = isRecord(raw) ? raw : {};
  const cached = isRecord(source.cachedStats)
    ? { ...cloneJson(emptyStats), ...(cloneJson(source.cachedStats) as Partial<DashboardStats>), live: false }
    : cloneJson(emptyStats);

  return {
    settings: normalizeSettings(source.settings as Partial<AppSettings>),
    commands: normalizeCommands(source.commands),
    chatAlerts: normalizeChatAlerts(source.chatAlerts),
    customVariables: Array.isArray(source.customVariables)
      ? cloneJson(source.customVariables as CustomVariable[])
      : cloneJson(defaultCustomVariables),
    channelRewards: Array.isArray(source.channelRewards)
      ? cloneJson(source.channelRewards as ChannelPointReward[])
      : [],
    giveaway: normalizeGiveaway(source.giveaway),
    cachedStats: cached,
  };
}

export function extractSnapshotFromState(state: {
  settings: AppSettings;
  commands: ChatCommand[];
  chatAlerts: ChatAlertsConfig;
  customVariables: CustomVariable[];
  channelRewards: ChannelPointReward[];
  giveaway: GiveawayState;
  stats: DashboardStats;
}): ProfileConfigSnapshot {
  return normalizeProfileSnapshot({
    settings: state.settings,
    commands: state.commands,
    chatAlerts: state.chatAlerts,
    customVariables: state.customVariables,
    channelRewards: state.channelRewards,
    giveaway: state.giveaway,
    cachedStats: { ...state.stats, live: false },
  });
}

export function createCleanSnapshot(machineSource?: AppSettings): ProfileConfigSnapshot {
  const base = normalizeProfileSnapshot(undefined);
  if (machineSource) {
    base.settings.language = machineSource.language;
    base.settings.launchAtStartup = machineSource.launchAtStartup;
    base.settings.keepUserData = machineSource.keepUserData;
    base.settings.minimizeToTray = machineSource.minimizeToTray;
    base.settings.trayStyle = machineSource.trayStyle;
    base.settings.onboardingCompleted = true;
  }
  return base;
}

function isGenericProfileName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return !normalized || normalized === "default" || normalized === "standard";
}

function normalizeUserProfile(raw: unknown, fallbackIndex: number): UserProfile | undefined {
  if (!isRecord(raw)) return undefined;
  const now = Date.now();
  const id = typeof raw.id === "string" && raw.id.trim()
    ? raw.id.trim()
    : createProfileId("profile");
  const twitchUserId =
    typeof raw.twitchUserId === "string" && raw.twitchUserId.trim()
      ? raw.twitchUserId.trim()
      : undefined;
  const twitchLogin =
    typeof raw.twitchLogin === "string" && raw.twitchLogin.trim()
      ? raw.twitchLogin.trim()
      : undefined;
  const fallbackName = twitchLogin || (id === DEFAULT_PROFILE_ID ? "Standard" : `Profile ${fallbackIndex + 1}`);
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : fallbackName;
  return {
    id,
    name,
    twitchUserId,
    twitchLogin,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
    data: normalizeProfileSnapshot(raw.data as Partial<ProfileConfigSnapshot>),
  };
}

export function bootstrapProfiles(params: {
  rawProfiles: unknown;
  rawActiveProfileId: unknown;
  rawLastTwitchUserId: unknown;
  rawProfilesAutoSwitch: unknown;
  currentSnapshot: ProfileConfigSnapshot;
  defaultName: string;
}): {
  profiles: UserProfile[];
  activeProfileId: string;
  lastTwitchUserId?: string;
  profilesAutoSwitch: boolean;
} {
  const parsed = Array.isArray(params.rawProfiles)
    ? params.rawProfiles
        .map((item, idx) => normalizeUserProfile(item, idx))
        .filter((item): item is UserProfile => Boolean(item))
    : [];

  const deduped: UserProfile[] = [];
  const seenIds = new Set<string>();
  for (const profile of parsed) {
    if (!seenIds.has(profile.id)) {
      seenIds.add(profile.id);
      deduped.push(profile);
    }
  }

  const now = Date.now();
  if (!deduped.length) {
    deduped.push({
      id: DEFAULT_PROFILE_ID,
      name: params.defaultName,
      createdAt: now,
      updatedAt: now,
      data: cloneJson(params.currentSnapshot),
    });
  }

  const requestedId =
    typeof params.rawActiveProfileId === "string" && params.rawActiveProfileId.trim()
      ? params.rawActiveProfileId.trim()
      : deduped[0].id;
  const activeProfile = deduped.find((p) => p.id === requestedId) ?? deduped[0];

  const syncedProfiles = deduped.map((p) =>
    p.id === activeProfile.id
      ? { ...p, data: cloneJson(params.currentSnapshot), updatedAt: p.updatedAt || now }
      : p,
  );

  return {
    profiles: syncedProfiles,
    activeProfileId: activeProfile.id,
    lastTwitchUserId:
      typeof params.rawLastTwitchUserId === "string" && params.rawLastTwitchUserId.trim()
        ? params.rawLastTwitchUserId.trim()
        : undefined,
    profilesAutoSwitch:
      typeof params.rawProfilesAutoSwitch === "boolean"
        ? params.rawProfilesAutoSwitch
        : true,
  };
}

export function resolveProfileForTwitchAccount(params: {
  session: TwitchSession;
  profiles: UserProfile[];
  activeProfileId: string;
  lastTwitchUserId?: string;
  profilesAutoSwitch: boolean;
  currentSnapshot: ProfileConfigSnapshot;
}): {
  profiles: UserProfile[];
  activeProfileId: string;
  lastTwitchUserId: string;
  appliedProfile?: UserProfile;
  reason?: "switched" | "linked" | "created";
} {
  const now = Date.now();
  const { session, activeProfileId, lastTwitchUserId, profilesAutoSwitch, currentSnapshot } = params;

  // Always snapshot current live config into the currently active profile first.
  let nextProfiles = params.profiles.map((profile) =>
    profile.id === activeProfileId
      ? {
          ...profile,
          data: cloneJson(currentSnapshot),
          updatedAt: now,
          ...(profile.twitchUserId === session.userId ? { twitchLogin: session.login } : {}),
        }
      : profile.twitchUserId === session.userId
        ? { ...profile, twitchLogin: session.login }
        : profile,
  );

  if (!nextProfiles.some((p) => p.id === activeProfileId)) {
    nextProfiles = [
      {
        id: activeProfileId || DEFAULT_PROFILE_ID,
        name: session.login,
        createdAt: now,
        updatedAt: now,
        data: cloneJson(currentSnapshot),
      },
      ...nextProfiles,
    ];
  }

  const accountChanged = lastTwitchUserId !== session.userId;
  const existingLinked = nextProfiles.find((p) => p.twitchUserId === session.userId);

  if (existingLinked) {
    if (profilesAutoSwitch && accountChanged && existingLinked.id !== activeProfileId) {
      return {
        profiles: nextProfiles,
        activeProfileId: existingLinked.id,
        lastTwitchUserId: session.userId,
        appliedProfile: existingLinked,
        reason: "switched",
      };
    }
    return {
      profiles: nextProfiles,
      activeProfileId,
      lastTwitchUserId: session.userId,
    };
  }

  const activeProfile = nextProfiles.find((p) => p.id === activeProfileId);
  if (
    activeProfile &&
    !activeProfile.twitchUserId &&
    (activeProfile.id === DEFAULT_PROFILE_ID || !lastTwitchUserId)
  ) {
    const newId = nextProfiles.some((p) => p.id === `twitch:${session.userId}`)
      ? activeProfile.id
      : `twitch:${session.userId}`;
    const linked: UserProfile = {
      ...activeProfile,
      id: newId,
      name: isGenericProfileName(activeProfile.name) ? session.login : activeProfile.name,
      twitchUserId: session.userId,
      twitchLogin: session.login,
      updatedAt: now,
    };
    nextProfiles = nextProfiles.map((p) => (p.id === activeProfile.id ? linked : p));
    return {
      profiles: nextProfiles,
      activeProfileId: linked.id,
      lastTwitchUserId: session.userId,
      reason: "linked",
    };
  }

  if (!profilesAutoSwitch || !accountChanged) {
    return {
      profiles: nextProfiles,
      activeProfileId,
      lastTwitchUserId: session.userId,
    };
  }

  const createdId = nextProfiles.some((p) => p.id === `twitch:${session.userId}`)
    ? createProfileId("twitch")
    : `twitch:${session.userId}`;
  const createdProfile: UserProfile = {
    id: createdId,
    name: session.login,
    twitchUserId: session.userId,
    twitchLogin: session.login,
    createdAt: now,
    updatedAt: now,
    data: createCleanSnapshot(currentSnapshot.settings),
  };
  nextProfiles = [...nextProfiles, createdProfile];
  return {
    profiles: nextProfiles,
    activeProfileId: createdProfile.id,
    lastTwitchUserId: session.userId,
    appliedProfile: createdProfile,
    reason: "created",
  };
}

export function buildPersistenceBatch(
  snapshot: ProfileConfigSnapshot,
  meta?: {
    profiles?: UserProfile[];
    activeProfileId?: string;
    lastTwitchUserId?: string;
    profilesAutoSwitch?: boolean;
  },
): Record<string, unknown> {
  const batch: Record<string, unknown> = {
    ...snapshot.settings,
    commands: snapshot.commands,
    chatAlerts: snapshot.chatAlerts,
    customVariables: snapshot.customVariables,
    channelRewards: snapshot.channelRewards,
    giveaway: snapshot.giveaway,
    cachedStats: snapshot.cachedStats,
  };
  if (meta?.profiles !== undefined) batch.profiles = meta.profiles;
  if (meta?.activeProfileId !== undefined) batch.activeProfileId = meta.activeProfileId;
  if (meta?.lastTwitchUserId !== undefined) batch.lastTwitchUserId = meta.lastTwitchUserId;
  if (meta?.profilesAutoSwitch !== undefined) batch.profilesAutoSwitch = meta.profilesAutoSwitch;
  return batch;
}

export function mergeSnapshotSections(
  target: ProfileConfigSnapshot,
  source: ProfileConfigSnapshot,
  sections: Omit<ProfileExportSections, "history">,
  options?: { mergeCollections?: boolean },
): ProfileConfigSnapshot {
  const next = cloneJson(target);
  const src = normalizeProfileSnapshot(source);

  if (sections.appearance) {
    for (const key of APPEARANCE_KEYS) {
      (next.settings[key] as AppSettings[typeof key]) = cloneJson(src.settings[key]);
    }
  }
  if (sections.dashboard) {
    for (const key of DASHBOARD_KEYS) {
      (next.settings[key] as AppSettings[typeof key]) = cloneJson(src.settings[key]);
    }
  }
  if (sections.chatAndObs) {
    for (const key of CHAT_AND_OBS_KEYS) {
      (next.settings[key] as AppSettings[typeof key]) = cloneJson(src.settings[key]);
    }
  }
  if (sections.automation) {
    for (const key of AUTOMATION_SETTINGS_KEYS) {
      (next.settings[key] as AppSettings[typeof key]) = cloneJson(src.settings[key]);
    }
    next.chatAlerts = cloneJson(src.chatAlerts);
    next.giveaway = cloneJson(src.giveaway);

    if (options?.mergeCollections) {
      const cmdMap = new Map(next.commands.map((c) => [c.name.toLowerCase(), c]));
      for (const cmd of src.commands) {
        if (!cmdMap.has(cmd.name.toLowerCase())) {
          next.commands.push(cloneJson(cmd));
          cmdMap.set(cmd.name.toLowerCase(), cmd);
        }
      }
      next.commands = normalizeCommands(next.commands);

      const varMap = new Map(next.customVariables.map((v) => [v.name.toLowerCase(), v]));
      for (const v of src.customVariables) {
        if (!varMap.has(v.name.toLowerCase())) {
          next.customVariables.push(cloneJson(v));
          varMap.set(v.name.toLowerCase(), v);
        }
      }

      const rewardIds = new Set(next.channelRewards.map((r) => r.id));
      for (const reward of src.channelRewards) {
        if (!rewardIds.has(reward.id)) {
          next.channelRewards.push(cloneJson(reward));
        }
      }
    } else {
      next.commands = normalizeCommands(src.commands);
      next.customVariables = cloneJson(src.customVariables);
      next.channelRewards = cloneJson(src.channelRewards);
    }
  }

  return normalizeProfileSnapshot(next);
}

export function filterSnapshotForExport(
  snapshot: ProfileConfigSnapshot,
  sections: ProfileExportSections,
): ProfileConfigSnapshot {
  return mergeSnapshotSections(createCleanSnapshot(), snapshot, {
    appearance: sections.appearance,
    dashboard: sections.dashboard,
    chatAndObs: sections.chatAndObs,
    automation: sections.automation,
  });
}

export function createExportBundle(params: {
  scope: "profile" | "all";
  profiles: UserProfile[];
  activeProfileId: string;
  targetProfileId?: string;
  included: ProfileExportSections;
  appVersion?: string;
  events?: ActivityEvent[];
  chatMessages?: ChatMessage[];
}): ProfileExportBundle {
  const chosen =
    params.scope === "all"
      ? params.profiles
      : params.profiles.filter(
          (p) => p.id === (params.targetProfileId ?? params.activeProfileId),
        );

  const sanitizedProfiles = (chosen.length ? chosen : params.profiles.slice(0, 1)).map(
    (profile) => ({
      ...cloneJson(profile),
      data: filterSnapshotForExport(profile.data, params.included),
    }),
  );

  return {
    format: "streamdash-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    appVersion: params.appVersion,
    scope: params.scope,
    included: { ...params.included },
    activeProfileId: params.activeProfileId,
    profiles: sanitizedProfiles,
    ...(params.included.history
      ? {
          events: cloneJson(params.events ?? []),
          chatMessages: cloneJson(params.chatMessages ?? []),
        }
      : {}),
  };
}

export function parseImportBundle(rawText: string): {
  bundle?: ProfileExportBundle;
  error?: "invalidJson" | "unsupportedFormat" | "emptyProfiles";
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { error: "invalidJson" };
  }
  if (!isRecord(parsed) || parsed.format !== "streamdash-backup" || parsed.version !== 1) {
    return { error: "unsupportedFormat" };
  }
  if (!Array.isArray(parsed.profiles) || !parsed.profiles.length) {
    return { error: "emptyProfiles" };
  }

  const normalizedProfiles = parsed.profiles
    .map((p, idx) => normalizeUserProfile(p, idx))
    .filter((p): p is UserProfile => Boolean(p));

  if (!normalizedProfiles.length) {
    return { error: "emptyProfiles" };
  }

  const rawIncluded = isRecord(parsed.included) ? parsed.included : {};
  const hasEvents = Array.isArray(parsed.events) && parsed.events.length > 0;
  const hasChat = Array.isArray(parsed.chatMessages) && parsed.chatMessages.length > 0;

  return {
    bundle: {
      format: "streamdash-backup",
      version: 1,
      exportedAt:
        typeof parsed.exportedAt === "string"
          ? parsed.exportedAt
          : new Date().toISOString(),
      appVersion:
        typeof parsed.appVersion === "string" ? parsed.appVersion : undefined,
      scope: parsed.scope === "all" || normalizedProfiles.length > 1 ? "all" : "profile",
      included: {
        appearance:
          typeof rawIncluded.appearance === "boolean" ? rawIncluded.appearance : true,
        dashboard:
          typeof rawIncluded.dashboard === "boolean" ? rawIncluded.dashboard : true,
        chatAndObs:
          typeof rawIncluded.chatAndObs === "boolean" ? rawIncluded.chatAndObs : true,
        automation:
          typeof rawIncluded.automation === "boolean" ? rawIncluded.automation : true,
        history:
          typeof rawIncluded.history === "boolean"
            ? rawIncluded.history
            : hasEvents || hasChat,
      },
      activeProfileId:
        typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : undefined,
      profiles: normalizedProfiles,
      events: hasEvents ? (parsed.events as ActivityEvent[]) : undefined,
      chatMessages: hasChat ? (parsed.chatMessages as ChatMessage[]) : undefined,
    },
  };
}

export async function saveJsonFile(
  filename: string,
  content: string,
): Promise<"saved" | "cancelled"> {
  const win = window as Window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof win.showSaveFilePicker === "function") {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "StreamDash Backup (.json)",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Fall back to browser download below if picker is blocked/unsupported in context.
    }
  }

  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
