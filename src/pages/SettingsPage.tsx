import { enable, disable } from "@tauri-apps/plugin-autostart";
import {
  Archive,
  AtSign,
  BadgeCheck,
  Bell,
  CircleDollarSign,
  Clock3,
  Database,
  DatabaseBackup,
  EyeOff,
  Gift,
  Highlighter,
  Heart,
  Languages,
  LayoutDashboard,
  ListFilter,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  MonitorUp,
  Palette,
  PanelBottom,
  PanelLeft,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Rows3,
  Settings,
  Settings2,
  Smile,
  Sparkles,
  Star,
  Type,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Card, PageHeader } from "../components/ui";
import { defaultDashboardWidgets, useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { errorMessage, isTauri } from "../lib/utils";
import type { ActivityType, AppSettings } from "../types";
import { useTranslation } from "react-i18next";

const eventOptions: Array<{ id: ActivityType; label: string; icon: LucideIcon }> = [
  { id: "follow", label: "follows", icon: Heart },
  { id: "subscription", label: "subscriptions", icon: Star },
  { id: "resubscription", label: "resubs", icon: RefreshCw },
  { id: "gift_subscription", label: "giftSubs", icon: Gift },
  { id: "community_gift", label: "communityGifts", icon: Users },
  { id: "cheer", label: "cheers", icon: Sparkles },
  { id: "raid", label: "raids", icon: RadioTower },
  { id: "donation", label: "donations", icon: CircleDollarSign },
  { id: "channel_point", label: "channelPoints", icon: Sparkles },
  { id: "stream_online", label: "streamOnline", icon: RadioTower },
  { id: "stream_offline", label: "streamOffline", icon: RadioTower },
];

function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={value}
      data-state={value ? "on" : "off"}
      onClick={() => onChange(!value)}
      className="toggle-switch relative h-5 w-9 rounded-full transition-colors"
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left] ${value ? "left-4.5" : "left-0.5"}`}
      />
    </button>
  );
}
function Row({
  icon: Icon,
  label,
  detail,
  children,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-0">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/[.035] text-zinc-500">
          <Icon size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-sm">{label}</div>
          <div className="mt-1 text-xs text-muted">{detail}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-bold tracking-[.14em] text-zinc-600">
      <Icon size={12} aria-hidden="true" />
      {children}
    </h2>
  );
}
function HighlightWords({
  value,
  onSave,
}: {
  value: string[];
  onSave: (value: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value.join(", "));
  return (
    <input
      aria-label={t("settings.highlightWords")}
      className="input max-w-72"
      placeholder={t("settings.highlightWordsPlaceholder")}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() =>
        onSave([
          ...new Set(
            draft
              .split(",")
              .map((word) => word.trim())
              .filter(Boolean),
          ),
        ])
      }
    />
  );
}

export function SettingsPage() {
  const { settings, setSettings } = useAppStore();
  const { t } = useTranslation();

  const update = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    try {
      if (key === "launchAtStartup" && isTauri())
        await (value ? enable() : disable());
      setSettings({ [key]: value });
      await saveSetting(key, value);
    } catch (error) {
      toast.error(t("settings.saveError"), {
        description: errorMessage(error),
      });
    }
  };
  return (
    <>
      <PageHeader icon={Settings} title={t("settings.title")} />
      <div className="space-y-4">
        <section>
          <SectionTitle icon={Settings2}>{t("settings.general")}</SectionTitle>
          <Card className="px-5">
            <Row
              icon={Languages}
              label={t("settings.language")}
              detail={t("settings.languageDetail")}
            >
              <select
                className="input w-52"
                value={settings.language}
                onChange={(event) =>
                  update(
                    "language",
                    event.target.value as AppSettings["language"],
                  )
                }
              >
                <option value="auto">{t("common.automatic")}</option>
                <option value="en">{t("languages.en")}</option>
                <option value="de">{t("languages.de")}</option>
                <option value="es">{t("languages.es")}</option>
                <option value="pt-BR">{t("languages.pt-BR")}</option>
                <option value="fr">{t("languages.fr")}</option>
              </select>
            </Row>
            <Row
              icon={MonitorUp}
              label={t("settings.launchWithWindows")}
              detail={t("settings.launchWithWindowsDetail")}
            >
              <Toggle
                value={settings.launchAtStartup}
                onChange={(value) => update("launchAtStartup", value)}
              />
            </Row>
            <Row
              icon={PanelBottom}
              label={t("settings.minimizeToTray")}
              detail={t("settings.minimizeToTrayDetail")}
            >
              <Toggle
                value={settings.minimizeToTray}
                onChange={(value) => update("minimizeToTray", value)}
              />
            </Row>
            <Row
              icon={DatabaseBackup}
              label={t("settings.keepData")}
              detail={t("settings.keepDataDetail")}
            >
              <Toggle
                value={settings.keepUserData}
                onChange={(value) => update("keepUserData", value)}
              />
            </Row>
          </Card>
        </section>
        <section>
          <SectionTitle icon={Palette}>{t("settings.appearance")}</SectionTitle>
          <Card className="px-5">
            <Row
              icon={Rows3}
              label={t("settings.interfaceDensity")}
              detail={t("settings.interfaceDensityDetail")}
            >
              <select
                className="input w-40"
                value={settings.uiDensity}
                onChange={(event) =>
                  update(
                    "uiDensity",
                    event.target.value as AppSettings["uiDensity"],
                  )
                }
              >
                <option value="compact">{t("settings.compact")}</option>
                <option value="comfortable">{t("settings.comfortable")}</option>
              </select>
            </Row>
            <Row
              icon={Maximize2}
              label={t("settings.contentWidth")}
              detail={t("settings.contentWidthDetail")}
            >
              <select
                className="input w-40"
                value={settings.contentWidth}
                onChange={(event) =>
                  update(
                    "contentWidth",
                    event.target.value as AppSettings["contentWidth"],
                  )
                }
              >
                <option value="compact">{t("settings.focused")}</option>
                <option value="wide">{t("settings.wide")}</option>
                <option value="full">{t("settings.fullWidth")}</option>
              </select>
            </Row>
            <Row
              icon={Palette}
              label={t("settings.accentColor")}
              detail={t("settings.accentColorDetail")}
            >
              <select
                className="input w-40"
                value={settings.accentColor}
                onChange={(event) =>
                  update(
                    "accentColor",
                    event.target.value as AppSettings["accentColor"],
                  )
                }
              >
                <option value="violet">{t("settings.violet")}</option>
                <option value="blue">{t("settings.blue")}</option>
                <option value="emerald">{t("settings.emerald")}</option>
                <option value="orange">{t("settings.orange")}</option>
              </select>
            </Row>
            <Row
              icon={PanelLeft}
              label={t("settings.compactNavigation")}
              detail={t("settings.compactNavigationDetail")}
            >
              <Toggle
                value={settings.sidebarCollapsed}
                onChange={(value) => update("sidebarCollapsed", value)}
              />
            </Row>
            <Row
              icon={Rows3}
              label={t("settings.compactActivity")}
              detail={t("settings.compactActivityDetail")}
            >
              <Toggle
                value={settings.compactFeed}
                onChange={(value) => update("compactFeed", value)}
              />
            </Row>
            <Row icon={Sparkles} label={t("settings.animations")} detail={t("settings.animationsDetail")}>
              <Toggle
                value={settings.animations}
                onChange={(value) => update("animations", value)}
              />
            </Row>
            <Row
              icon={LayoutDashboard}
              label={t("settings.dashboardLayout")}
              detail={t("settings.dashboardLayoutDetail", { count: settings.dashboardWidgets.length })}
            >
              <Button
                onClick={async () => {
                  setSettings({
                    dashboardWidgets: defaultDashboardWidgets,
                    dashboardWidgetDimensions: {},
                    dashboardZoom: 100,
                  });
                  try {
                    await Promise.all([
                      saveSetting("dashboardWidgets", defaultDashboardWidgets),
                      saveSetting("dashboardWidgetDimensions", {}),
                      saveSetting("dashboardZoom", 100),
                    ]);
                  } catch (error) {
                    toast.error(t("settings.dashboardResetError"), {
                      description: errorMessage(error),
                    });
                  }
                }}
              >
                <RotateCcw size={14} />
                {t("common.reset")}
              </Button>
            </Row>
          </Card>
        </section>
        <section>
          <SectionTitle icon={Bell}>{t("settings.notifications")}</SectionTitle>
          <Card className="px-5">
            <Row
              icon={Bell}
              label={t("settings.windowsNotifications")}
              detail={t("settings.windowsNotificationsDetail")}
            >
              <Toggle
                value={settings.notifications}
                onChange={(value) => update("notifications", value)}
              />
            </Row>
            <Row icon={CircleDollarSign} label={t("settings.donations")} detail={t("settings.donationsDetail")}>
              <Toggle
                value={settings.notifyDonations}
                onChange={(value) => update("notifyDonations", value)}
              />
            </Row>
            <Row icon={RadioTower} label={t("settings.raids")} detail={t("settings.raidsDetail")}>
              <Toggle
                value={settings.notifyRaids}
                onChange={(value) => update("notifyRaids", value)}
              />
            </Row>
            <Row
              icon={Gift}
              label={t("settings.giftSubscriptions")}
              detail={t("settings.giftSubscriptionsDetail")}
            >
              <Toggle
                value={settings.notifyGiftSubs}
                onChange={(value) => update("notifyGiftSubs", value)}
              />
            </Row>
          </Card>
        </section>
        <section>
          <SectionTitle icon={MessageSquare}>{t("settings.chat")}</SectionTitle>
          <Card className="px-5">
            <Row
              icon={Clock3}
              label={t("settings.timestamps")}
              detail={t("settings.timestampsDetail")}
            >
              <Toggle
                value={settings.chatTimestamps}
                onChange={(value) => update("chatTimestamps", value)}
              />
            </Row>
            <Row
              icon={BadgeCheck}
              label={t("settings.badges")}
              detail={t("settings.badgesDetail")}
            >
              <Toggle
                value={settings.chatBadges}
                onChange={(value) => update("chatBadges", value)}
              />
            </Row>
            <Row
              icon={AtSign}
              label={t("settings.highlightMentions")}
              detail={t("settings.highlightMentionsDetail")}
            >
              <Toggle
                value={settings.chatHighlightMentions}
                onChange={(value) => update("chatHighlightMentions", value)}
              />
            </Row>
            <Row
              icon={Highlighter}
              label={t("settings.highlightWords")}
              detail={t("settings.highlightWordsDetail")}
            >
              <HighlightWords
                value={settings.chatHighlightWords}
                onSave={(value) => update("chatHighlightWords", value)}
              />
            </Row>
            <Row icon={Type} label={t("settings.textSize")} detail={t("settings.textSizeDetail")}>
              <select
                className="input w-32"
                value={settings.chatFontSize}
                onChange={(event) =>
                  update("chatFontSize", Number(event.target.value))
                }
              >
                <option value={12}>{t("settings.small")}</option>
                <option value={13}>{t("settings.normal")}</option>
                <option value={14}>{t("settings.large")}</option>
                <option value={16}>{t("settings.extraLarge")}</option>
              </select>
            </Row>
            <Row
              icon={Smile}
              label={t("settings.emoteSize")}
              detail={t("settings.emoteSizeDetail")}
            >
              <select
                className="input w-32"
                value={settings.chatEmoteSize}
                onChange={(event) =>
                  update("chatEmoteSize", Number(event.target.value))
                }
              >
                <option value={24}>{t("settings.small")}</option>
                <option value={28}>{t("settings.normal")}</option>
                <option value={34}>{t("settings.large")}</option>
                <option value={40}>{t("settings.extraLarge")}</option>
              </select>
            </Row>
            <Row
              icon={MessagesSquare}
              label={t("settings.messageBuffer")}
              detail={t("settings.messageBufferDetail")}
            >
              <select
                className="input w-32"
                value={settings.maximumChatMessages}
                onChange={(event) =>
                  update("maximumChatMessages", Number(event.target.value))
                }
              >
                <option value={400}>400</option>
                <option value={1000}>1,000</option>
                <option value={2000}>2,000</option>
                <option value={5000}>5,000</option>
              </select>
            </Row>
            <Row
              icon={EyeOff}
              label={t("settings.hiddenUsers")}
              detail={t("settings.hiddenUsersDetail", { count: settings.chatHiddenUsers.length })}
            >
              <Button
                disabled={!settings.chatHiddenUsers.length}
                onClick={() => update("chatHiddenUsers", [])}
              >
                {t("common.showAll")}
              </Button>
            </Row>
            <Row
              icon={Highlighter}
              label={t("settings.highlightExclusions")}
              detail={t("settings.highlightExclusionsDetail", { count: settings.chatHighlightIgnoredUsers.length })}
            >
              <Button
                disabled={!settings.chatHighlightIgnoredUsers.length}
                onClick={() => update("chatHighlightIgnoredUsers", [])}
              >
                {t("common.reset")}
              </Button>
            </Row>
          </Card>
        </section>
        <section>
          <SectionTitle icon={ListFilter}>{t("settings.events")}</SectionTitle>
          <Card className="p-4">
            <p className="mb-3 text-xs text-muted">
              {t("settings.eventsDetail")}
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
              {eventOptions.map((option) => {
                const Icon = option.icon;
                const enabled = !settings.disabledEventTypes.includes(
                  option.id,
                );
                return (
                  <button
                    key={option.id}
                    onClick={() =>
                      update(
                        "disabledEventTypes",
                        enabled
                          ? [...settings.disabledEventTypes, option.id]
                          : settings.disabledEventTypes.filter(
                              (id) => id !== option.id,
                            ),
                      )
                    }
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${enabled ? "border-accent/30 bg-accent-soft text-zinc-200" : "border-line bg-black/10 text-zinc-600"}`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon size={13} aria-hidden="true" />
                      {t(`settings.${option.label}`)}
                    </span>
                    <span
                      className={`size-1.5 rounded-full ${enabled ? "bg-accent" : "bg-zinc-700"}`}
                    />
                  </button>
                );
              })}
            </div>
          </Card>
        </section>
        <section>
          <SectionTitle icon={Database}>{t("settings.data")}</SectionTitle>
          <Card className="px-5">
            <Row
              icon={Archive}
              label={t("settings.maximumEvents")}
              detail={t("settings.maximumEventsDetail")}
            >
              <select
                className="input w-32"
                value={settings.maximumEvents}
                onChange={(event) =>
                  update("maximumEvents", Number(event.target.value))
                }
              >
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
                <option value={50000}>50,000</option>
              </select>
            </Row>
          </Card>
        </section>
      </div>
    </>
  );
}
