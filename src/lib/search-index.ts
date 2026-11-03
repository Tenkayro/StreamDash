import type { TFunction } from "i18next";
import i18n from "../i18n";
import { useAppStore } from "../stores/app-store";
import { navigationItems } from "./navigation";
import { searchableSettings } from "./search-settings";
import type { SearchEntry } from "./search";
import { money } from "./utils";

export function buildSearchIndex(state: ReturnType<typeof useAppStore.getState>, t: TFunction): SearchEntry[] {
  const en = i18n.getFixedT("en");
  const entries: SearchEntry[] = navigationItems.map((item) => ({
    id: `page:${item.id}`, group: "pages", title: t(`nav.${item.label}`),
    description: i18n.exists(`pageDescriptions.${item.id}`) ? t(`pageDescriptions.${item.id}`) : t(`navigation.${item.group}`),
    keywords: `${item.id} ${en(`nav.${item.label}`)} ${t(`search.aliases.${item.id}`, { defaultValue: "" })}`,
    target: { page: item.id },
  }));
  for (const setting of searchableSettings) entries.push({
    id: setting.key, group: "settings", title: t(setting.key),
    description: t("search.location", { page: t("nav.settings"), section: t(`settings.${setting.section}`) }),
    keywords: `${setting.key === "settings.accentColor" ? ["violet", "blue", "emerald", "orange"].map((color) => `${t(`settings.${color}`)} ${en(`settings.${color}`)}`).join(" ") : ""} ${en(setting.key)} ${"detail" in setting ? t(setting.detail) : ""} ${t(`search.aliases.${setting.section}`, { defaultValue: "" })}`,
    target: { page: "settings", label: t(setting.key) },
  });
  const features: Record<string, string[]> = {
    dashboard: ["dashboard.customize", "dashboard.addBrowserSource", "dashboard.widgets"],
    stream: ["stream.streamTitle", "stream.category", "stream.language", "stream.addMarker"],
    obs: ["obs.page.scenes", "obs.page.audioMixer", "obs.mic", "obs.desktop", "obs.page.outputControls", "obs.page.recordingOutput", "obs.page.performance", "obs.page.details", "obs.spotifyOverlay.title"],
    goals: ["goals.followers", "goals.subscribers", "goals.donations", "goals.bits", "goals.raids", "goals.giftSubscriptions", "goals.autoTarget"],
  };
  for (const [page, keys] of Object.entries(features)) for (const key of keys) {
    if (!i18n.exists(key)) continue;
    entries.push({ id: `feature:${key}`, group: "features", title: t(key), description: t(`nav.${page}`),
      keywords: `${en(key)} ${page} ${t(`search.aliases.${page}`, { defaultValue: "" })}`, target: { page, ...(page === "goals" ? { label: t(key) } : {}) } });
  }
  for (const [name, connection] of [["Twitch", state.twitch], ["StreamElements", state.streamElements], ["TipeeeStream", state.tipeeStream], ["OBS", state.obs]] as const) {
    entries.push({ id: `service:${name}`, group: "features", title: name,
      description: t("search.serviceStatus", { account: connection.account || t("nav.connections"), status: t(`connectionPhases.${connection.phase}`) }),
      keywords: `${connection.account ?? ""} ${t("nav.connections")} ${en("nav.connections")}`,
      target: { page: "connections", label: name } });
  }
  for (const key of ["followers", "subscribers", "currentViewers", "streamDuration", "bitsCollected", "donations", "streamStatus", "activityEvents", "recentActivity", "streamDetails"]) entries.push({
    id: `metric:${key}`, group: "features", title: t(`dashboard.${key}`), description: t("nav.dashboard"), keywords: en(`dashboard.${key}`), target: { page: "dashboard" },
  });
  if (state.stats.title || state.stats.category) entries.push({ id: "current-stream", group: "features", title: state.stats.title || t("stream.streamTitle"), description: state.stats.category || t("nav.stream"), target: { page: "stream" } });
  for (const source of state.settings.dashboardBrowserSources) entries.push({ id: `widget:${source.id}`, group: "features", title: source.name || t("dashboard.browserSource"), description: t("dashboard.browserSource"), target: { page: "dashboard" } });
  for (const scene of state.obsSnapshot?.scenes ?? []) entries.push({ id: `scene:${scene}`, group: "features", title: scene, description: t("obs.scene"), keywords: "OBS", target: { page: "obs" } });
  for (const event of state.events) {
    const name = event.displayName || event.username || t("activity.anonymous");
    const title = t("search.activityTitle", { name, event: t(`events.${event.eventType}`) });
    entries.push({ id: `event:${event.id}`, group: "activity", title,
      description: [event.source, event.amount !== undefined ? money(event.amount, event.currency) : "", event.message].filter(Boolean).join(" · "),
      keywords: `${event.username ?? ""} ${event.bits ?? ""} ${event.timestamp} ${en(`events.${event.eventType}`)}`,
      target: { page: event.eventType === "donation" ? "donations" : "activity", filter: event.message || event.username || event.displayName || t("activity.anonymous"), itemId: event.id } });
  }
  for (const message of state.chatMessages) {
    if (message.deleted || state.settings.chatHiddenUsers.some((user) => user.toLowerCase() === message.login.toLowerCase())) continue;
    entries.push({ id: `chat:${message.id}`, group: "chat", title: message.displayName, description: message.text,
      keywords: message.login, target: { page: "chat", filter: message.text || message.displayName, itemId: message.id } });
  }
  return entries;
}
