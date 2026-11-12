import { enable, disable } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bell,
  Bot,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  Languages,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageSquare,
  MonitorUp,
  Palette,
  PanelBottom,
  Rocket,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { resolveLanguage } from "../i18n";
import { cn, errorMessage, isTauri } from "../lib/utils";
import { saveSetting } from "../services/native";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import type {
  AccentColor,
  AppLanguage,
  AppSettings,
  ConnectionPhase,
} from "../types";
import { Badge, Button, LoadingIndicator, ScrollFade, Toggle } from "./ui";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import obsIcon from "../assets/services/obs.svg";
import twitchIcon from "../assets/services/twitch.webp";

const streamElementsTokenUrl =
  "https://streamelements.com/dashboard/account/channels";
const tipeeStreamTokenUrl = "https://www.tipeeestream.com/dashboard/api-key";

const languages: Array<{ value: AppLanguage; label: string }> = [
  { value: "auto", label: "common.automatic" },
  { value: "en", label: "languages.en" },
  { value: "de", label: "languages.de" },
  { value: "es", label: "languages.es" },
  { value: "pt-BR", label: "languages.pt-BR" },
  { value: "fr", label: "languages.fr" },
];

const accentColors: Array<{ value: AccentColor; label: string; dot: string }> = [
  { value: "orange", label: "settings.orange", dot: "bg-orange-400" },
  { value: "violet", label: "settings.violet", dot: "bg-violet-400" },
  { value: "blue", label: "settings.blue", dot: "bg-sky-400" },
  { value: "emerald", label: "settings.emerald", dot: "bg-emerald-400" },
];

function ChoiceRow({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-black/15 px-3.5 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-zinc-100">{title}</div>
        <div className="mt-0.5 text-[11px] leading-4 text-muted">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function IntegrationRow({
  icon,
  tint,
  name,
  purpose,
  phase,
  error,
  helpUrl,
  onDisconnect,
  children,
}: {
  icon: string;
  tint: string;
  name: string;
  purpose: string;
  phase: ConnectionPhase;
  error?: string;
  helpUrl?: string;
  onDisconnect?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const connected = phase === "connected";
  const failed = phase === "error" || phase === "expired";
  return (
    <div className="rounded-xl border border-line bg-black/15 px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            tint,
          )}
        >
          <img src={icon} alt="" className="size-4 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-zinc-100">
              {name}
            </span>
            {connected && (
              <Badge tone="green">{t("connectionPhases.connected")}</Badge>
            )}
          </div>
          <div className="truncate text-[11px] text-muted">{purpose}</div>
        </div>
        {connected ? (
          onDisconnect && (
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded-lg px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/5 hover:text-red-300"
            >
              {t("connections.disconnect")}
            </button>
          )
        ) : (
          helpUrl && (
            <button
              type="button"
              onClick={() => void openUrl(helpUrl)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-accent hover:brightness-125"
            >
              <ExternalLink size={11} />
              {t("connections.openTokenInstructions")}
            </button>
          )
        )}
      </div>
      {connected ? null : (
        <>
          <div className="mt-2 flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center">
            {children}
          </div>
          {failed && error && (
            <p className="mt-1.5 text-[11px] leading-4 text-red-300">{error}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SetupWizard() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const {
    settings,
    setSettings,
    twitch,
    twitchBot,
    streamElements,
    tipeeStream,
    obs,
  } = useAppStore();
  const [step, setStep] = useState(0);
  const [token, setToken] = useState("");
  const [streamElementsBusy, setStreamElementsBusy] = useState(false);
  const [tipeeStreamKey, setTipeeeStreamKey] = useState("");
  const [tipeeStreamBusy, setTipeeeStreamBusy] = useState(false);
  const [obsAddress, setObsAddress] = useState(settings.obsAddress);
  const [obsPassword, setObsPassword] = useState("");
  const [obsBusy, setObsBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const steps: Array<{ icon: LucideIcon; label: string }> = [
    { icon: Languages, label: t("onboarding.steps.language") },
    { icon: Link2, label: t("onboarding.steps.twitch") },
    { icon: KeyRound, label: t("onboarding.steps.integrations") },
    { icon: ShieldCheck, label: t("onboarding.steps.preferences") },
    { icon: Rocket, label: t("onboarding.steps.ready") },
  ];

  const update = async <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    const previous = settings[key];
    setSettings({ [key]: value });
    try {
      if (key === "launchAtStartup" && isTauri())
        await (value ? enable() : disable());
      await saveSetting(key, value);
    } catch (error) {
      setSettings({ [key]: previous });
      toast.error(t("settings.saveError"), {
        description: errorMessage(error),
      });
    }
  };

  const selectLanguage = (language: AppLanguage) => {
    void update("language", language);
    const resolved = resolveLanguage(language);
    void i18n.changeLanguage(resolved);
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("donations.copied"));
    } catch {
      toast.error(t("donations.copyFailed"));
    }
  };

  const connectStreamElements = async () => {
    if (!token.trim() || streamElementsBusy) return;
    setStreamElementsBusy(true);
    try {
      await runtime.connectStreamElements(token);
      setToken("");
    } finally {
      setStreamElementsBusy(false);
    }
  };

  const connectTipeeeStream = async () => {
    if (!tipeeStreamKey.trim() || tipeeStreamBusy) return;
    setTipeeeStreamBusy(true);
    try {
      await runtime.connectTipeeeStream(tipeeStreamKey);
      setTipeeeStreamKey("");
    } finally {
      setTipeeeStreamBusy(false);
    }
  };

  const connectObs = async () => {
    if (obsBusy) return;
    setObsBusy(true);
    try {
      await runtime.connectObs(obsAddress, obsPassword);
      setObsPassword("");
    } finally {
      setObsBusy(false);
    }
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setSettings({ onboardingCompleted: true });
    try {
      await saveSetting("onboardingCompleted", true);
    } catch (error) {
      setSettings({ onboardingCompleted: false });
      setFinishing(false);
      toast.error(t("onboarding.finishError"), {
        description: errorMessage(error),
      });
    }
  };

  const content = [
    <div key="language" className="space-y-4">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Languages size={24} />
        </span>
        <h1 className="mt-3 text-xl font-semibold tracking-[-.03em]">
          {t("onboarding.languageTitle")}
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
          {t("onboarding.languageBody")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {languages.map((language) => {
          const selected = settings.language === language.value;
          return (
            <button
              type="button"
              key={language.value}
              onClick={() => selectLanguage(language.value)}
              className={cn(
                "relative rounded-xl border p-3 text-left transition",
                selected
                  ? "border-accent bg-accent-soft text-white"
                  : "border-line bg-black/15 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
              )}
            >
              <div className="text-xs font-semibold">{t(language.label)}</div>
              {language.value === "auto" && (
                <div className="mt-0.5 text-[10px] text-muted">
                  {t("onboarding.detectedLanguage", {
                    language: t(`languages.${resolveLanguage("auto")}`),
                  })}
                </div>
              )}
              {selected && (
                <Check size={13} className="absolute right-2.5 top-2.5 text-accent" />
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-line bg-black/15 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Palette size={15} className="text-accent" />
            <div>
              <div className="text-xs font-semibold text-zinc-100">
                {t("settings.accentColor")}
              </div>
              <div className="text-[11px] text-muted">
                {t("settings.accentColorDetail")}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {accentColors.map((item) => {
              const active = settings.accentColor === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => void update("accentColor", item.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                    active
                      ? "border-accent bg-accent-soft text-white"
                      : "border-line bg-white/3 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  <span className={cn("size-2.5 rounded-full", item.dot)} />
                  {t(item.label)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,

    <div key="twitch" className="space-y-3.5">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[#9146ff]/12">
          <img src={twitchIcon} alt="" className="size-7 object-contain" />
        </span>
        <h1 className="mt-3 text-xl font-semibold tracking-[-.03em]">
          {t("onboarding.twitchTitle")}
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
          {t("onboarding.twitchBody")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col justify-between rounded-xl border border-line bg-black/15 p-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#9146ff]/15">
                <img src={twitchIcon} alt="" className="size-5 object-contain" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-100">
                    Twitch
                  </span>
                  <Badge
                    tone={twitch.phase === "connected" ? "green" : "neutral"}
                  >
                    {t(`connectionPhases.${twitch.phase}`)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {t("connections.twitchPurpose")}
                </p>
              </div>
            </div>

            {twitch.phase === "connected" ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-400/8 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                  <span className="truncate text-xs font-medium text-emerald-200">
                    {t("onboarding.connectedAs", { account: twitch.account })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void runtime.disconnectTwitch()}
                  className="text-[11px] text-zinc-400 hover:text-red-300"
                >
                  {t("connections.disconnect")}
                </button>
              </div>
            ) : runtime.deviceAuth ? (
              <div className="mt-3 rounded-xl border border-accent/35 bg-accent-soft p-3 text-center">
                <div className="text-[11px] text-muted">
                  {t("connections.enterCode")}
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold tracking-[.18em] text-zinc-100">
                  {runtime.deviceAuth.code}
                </div>
                <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                  <Button
                    variant="primary"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => void openUrl(runtime.deviceAuth!.url)}
                  >
                    <ExternalLink size={13} />
                    {t("connections.openActivation")}
                  </Button>
                  <Button
                    className="h-8 px-2.5 text-xs"
                    onClick={() => void copyLink(runtime.deviceAuth!.url)}
                  >
                    <Copy size={13} />
                    {t("connections.copyActivationLink")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <Button
                  variant="primary"
                  className="w-full justify-center"
                  disabled={!isTauri() || twitch.phase === "connecting"}
                  onClick={() => void runtime.connectTwitch()}
                >
                  {twitch.phase === "connecting" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Link2 size={14} />
                  )}
                  {t("connections.connectTwitch")}
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2.5 text-[10.5px] leading-4 text-zinc-500">
            {t("onboarding.twitchConnectedDetail")}
          </p>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-line bg-black/15 p-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                <Bot size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-100">
                    {t("connections.twitchBot")}
                  </span>
                  <Badge
                    tone={twitchBot.phase === "connected" ? "green" : "neutral"}
                  >
                    {t(`connectionPhases.${twitchBot.phase}`)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {t("connections.twitchBotPurpose")}
                </p>
              </div>
            </div>

            {twitchBot.phase === "connected" ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/25 bg-emerald-400/8 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                  <span className="truncate text-xs font-medium text-emerald-200">
                    {t("onboarding.connectedAs", { account: twitchBot.account })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void runtime.disconnectTwitchBot()}
                  className="text-[11px] text-zinc-400 hover:text-red-300"
                >
                  {t("connections.disconnect")}
                </button>
              </div>
            ) : runtime.botDeviceAuth ? (
              <div className="mt-3 rounded-xl border border-accent/35 bg-accent-soft p-3 text-center">
                <div className="text-[11px] text-muted">
                  {t("connections.twitchBotActivateHint")}
                </div>
                <div className="mt-1.5 font-mono text-xl font-bold tracking-[.18em] text-zinc-100">
                  {runtime.botDeviceAuth.code}
                </div>
                <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                  <Button
                    variant="primary"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => void openUrl(runtime.botDeviceAuth!.url)}
                  >
                    <ExternalLink size={13} />
                    {t("connections.openActivation")}
                  </Button>
                  <Button
                    className="h-8 px-2.5 text-xs"
                    onClick={() => void copyLink(runtime.botDeviceAuth!.url)}
                  >
                    <Copy size={13} />
                    {t("connections.copyActivationLink")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <Button
                  variant="default"
                  className="w-full justify-center"
                  disabled={!isTauri() || twitchBot.phase === "connecting"}
                  onClick={() => void runtime.connectTwitchBot()}
                >
                  {twitchBot.phase === "connecting" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Bot size={14} />
                  )}
                  {t("connections.connectTwitchBot")}
                </Button>
              </div>
            )}
          </div>
          <p className="mt-2.5 text-[10.5px] leading-4 text-zinc-500">
            {t("onboarding.twitchBotHint")}
          </p>
        </div>
      </div>
    </div>,

    <div key="integrations" className="space-y-3">
      <div className="text-center">
        <div className="mx-auto flex items-center justify-center gap-2">
          {[
            { icon: streamElementsIcon, tint: "bg-cyan-400/10" },
            { icon: tipeeStreamIcon, tint: "bg-rose-400/10" },
            { icon: obsIcon, tint: "bg-zinc-300/10" },
          ].map(({ icon, tint }) => (
            <span
              key={icon}
              className={cn("grid size-10 place-items-center rounded-xl", tint)}
            >
              <img src={icon} alt="" className="size-5 object-contain" />
            </span>
          ))}
        </div>
        <h1 className="mt-2.5 text-xl font-semibold tracking-[-.03em]">
          {t("onboarding.integrationsTitle")}
        </h1>
        <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-muted">
          {t("onboarding.integrationsBody")}
        </p>
      </div>

      <div className="mx-auto max-w-xl space-y-2">
        <IntegrationRow
          icon={obsIcon}
          tint="bg-zinc-300/10"
          name="OBS Studio"
          purpose={t("connections.obsPurpose")}
          phase={obs.phase}
          error={obs.detail}
          onDisconnect={() => void runtime.disconnectObs()}
        >
          <div className="w-full shrink-0 sm:w-36">
            <input
              id="setup-obs-address"
              className="input text-xs"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("connections.obsAddress")}
              placeholder="127.0.0.1:4455"
              value={obsAddress}
              onChange={(event) => setObsAddress(event.target.value)}
            />
          </div>
          <input
            id="setup-obs-password"
            className="input min-w-0 flex-1 text-xs"
            type="password"
            autoComplete="off"
            aria-label={t("connections.obsPassword")}
            placeholder={t("connections.obsPasswordPlaceholder")}
            value={obsPassword}
            onChange={(event) => setObsPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !obsBusy && isTauri())
                void connectObs();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={obsBusy || !isTauri()}
            onClick={() => void connectObs()}
          >
            {obsBusy ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Link2 size={14} />
            )}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>

        <IntegrationRow
          icon={streamElementsIcon}
          tint="bg-cyan-400/10"
          name="StreamElements"
          purpose={t("connections.streamElementsPurpose")}
          phase={streamElements.phase}
          error={streamElements.detail}
          helpUrl={streamElementsTokenUrl}
          onDisconnect={() => void runtime.disconnectStreamElements()}
        >
          <input
            id="setup-se-token"
            className="input min-w-0 flex-1 text-xs"
            type="password"
            autoComplete="off"
            aria-label={t("onboarding.jwtLabel")}
            placeholder={t("connections.jwtPlaceholder")}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                token.trim() &&
                !streamElementsBusy &&
                isTauri()
              )
                void connectStreamElements();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={!token.trim() || streamElementsBusy || !isTauri()}
            onClick={() => void connectStreamElements()}
          >
            {streamElementsBusy ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <KeyRound size={14} />
            )}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>

        <IntegrationRow
          icon={tipeeStreamIcon}
          tint="bg-rose-400/10"
          name="TipeeeStream"
          purpose={t("connections.tipeeStreamPurpose")}
          phase={tipeeStream.phase}
          error={tipeeStream.detail}
          helpUrl={tipeeStreamTokenUrl}
          onDisconnect={() => void runtime.disconnectTipeeeStream()}
        >
          <input
            id="setup-tipee-key"
            className="input min-w-0 flex-1 text-xs"
            type="password"
            autoComplete="off"
            aria-label={t("connections.tipeeStreamApiKey")}
            placeholder={t("connections.tipeeStreamApiKeyPlaceholder")}
            value={tipeeStreamKey}
            onChange={(event) => setTipeeeStreamKey(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                tipeeStreamKey.trim() &&
                !tipeeStreamBusy &&
                isTauri()
              )
                void connectTipeeeStream();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={!tipeeStreamKey.trim() || tipeeStreamBusy || !isTauri()}
            onClick={() => void connectTipeeeStream()}
          >
            {tipeeStreamBusy ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <KeyRound size={14} />
            )}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>
      </div>
    </div>,

    <div key="preferences" className="space-y-3">
      <div className="text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <ShieldCheck size={24} />
        </span>
        <h1 className="mt-2.5 text-xl font-semibold tracking-[-.03em]">
          {t("onboarding.preferencesTitle")}
        </h1>
        <p className="mx-auto mt-1 max-w-lg text-xs leading-5 text-muted">
          {t("onboarding.preferencesBody")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ChoiceRow
          icon={MonitorUp}
          title={t("settings.launchWithWindows")}
          detail={t("settings.launchWithWindowsDetail")}
        >
          <Toggle
            value={settings.launchAtStartup}
            onChange={(value) => void update("launchAtStartup", value)}
          />
        </ChoiceRow>

        <ChoiceRow
          icon={PanelBottom}
          title={t("settings.minimizeToTray")}
          detail={t("settings.minimizeToTrayDetail")}
        >
          <Toggle
            value={settings.minimizeToTray}
            onChange={(value) => void update("minimizeToTray", value)}
          />
        </ChoiceRow>

        <ChoiceRow
          icon={Bell}
          title={t("settings.windowsNotifications")}
          detail={t("settings.windowsNotificationsDetail")}
        >
          <Toggle
            value={settings.notifications}
            onChange={(value) => void update("notifications", value)}
          />
        </ChoiceRow>

        <ChoiceRow
          icon={MessageSquare}
          title={t("settings.highlightMentions")}
          detail={t("settings.highlightMentionsDetail")}
        >
          <Toggle
            value={settings.chatHighlightMentions}
            onChange={(value) => void update("chatHighlightMentions", value)}
          />
        </ChoiceRow>

        <ChoiceRow
          icon={Sparkles}
          title={t("settings.animations")}
          detail={t("settings.animationsDetail")}
        >
          <Toggle
            value={settings.animations}
            onChange={(value) => void update("animations", value)}
          />
        </ChoiceRow>

        <ChoiceRow
          icon={LayoutDashboard}
          title={t("settings.compactActivity")}
          detail={t("settings.compactActivityDetail")}
        >
          <Toggle
            value={settings.compactFeed}
            onChange={(value) => void update("compactFeed", value)}
          />
        </ChoiceRow>
      </div>
    </div>,

    <div key="ready" className="text-center">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-400">
        <Sparkles size={28} />
      </span>
      <h1 className="mt-4 text-2xl font-semibold tracking-[-.04em]">
        {t("onboarding.readyTitle")}
      </h1>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted">
        {t("onboarding.readyBody")}
      </p>
      <div className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-2 text-left sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            {t("onboarding.languageSummary")}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
            {settings.language === "auto"
              ? t("common.automatic")
              : t(`languages.${settings.language}`)}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Twitch
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
            {twitch.phase === "connected"
              ? twitch.account
              : t("connectionPhases.disconnected")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            {t("connections.twitchBot")}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
            {twitchBot.phase === "connected"
              ? twitchBot.account
              : t("connectionPhases.disconnected")}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-black/15 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            OBS Studio
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-100">
            {t(`connectionPhases.${obs.phase}`)}
          </div>
        </div>
      </div>
      <Button
        className="mt-6"
        variant="primary"
        disabled={finishing}
        onClick={() => void finish()}
      >
        {finishing ? (
          <LoadingIndicator className="h-4 w-8" />
        ) : (
          <LayoutDashboard size={16} />
        )}
        {t("onboarding.start")}
      </Button>
    </div>,
  ];

  return (
    <ScrollFade className="flex min-h-0 flex-1 flex-col" color="#232425" size={48}>
      <main className="min-h-0 flex-1 overflow-y-auto bg-transparent p-3 sm:p-6">
        <div className="mx-auto grid min-h-full max-w-5xl place-items-center">
          <div className="grid w-full overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/35 md:grid-cols-[215px_minmax(0,1fr)]">
            <aside className="border-b border-line bg-black/15 p-4 md:border-b-0 md:border-r">
              <img
                src="/streamdash-logo-boot.webp"
                alt="StreamDash"
                className="h-auto w-36 max-w-full object-contain"
              />
              <div className="mt-5 flex gap-1.5 overflow-x-auto md:block md:space-y-1">
                {steps.map(({ icon: Icon, label }, index) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => setStep(index)}
                    className={cn(
                      "flex min-w-max items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition md:w-full",
                      index === step
                        ? "bg-accent-soft font-medium text-accent"
                        : index < step
                          ? "text-zinc-300 hover:bg-white/4"
                          : "text-zinc-500 hover:bg-white/4 hover:text-zinc-300",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-6 place-items-center rounded-full border",
                        index < step
                          ? "border-emerald-500/40 bg-emerald-400/10 text-emerald-400"
                          : index === step
                            ? "border-accent/50"
                            : "border-line",
                      )}
                    >
                      {index < step ? <Check size={12} /> : <Icon size={12} />}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </aside>
            <section className="flex min-h-0 flex-col p-5 sm:p-6 md:min-h-124">
              <div className="flex-1">{content[step]}</div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
                <div>
                  {step > 0 && (
                    <Button onClick={() => setStep((current) => current - 1)}>
                      <ChevronLeft size={14} />
                      {t("onboarding.back")}
                    </Button>
                  )}
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {step < steps.length - 1 && (
                    <button
                      type="button"
                      className="px-2 text-xs text-zinc-500 hover:text-zinc-200"
                      onClick={() => void finish()}
                    >
                      {t("onboarding.skipSetup")}
                    </button>
                  )}
                  {step < steps.length - 1 && (
                    <Button
                      variant="primary"
                      onClick={() => setStep((current) => current + 1)}
                    >
                      {step === 0
                        ? t("onboarding.continue")
                        : t("onboarding.next")}
                      <ChevronRight size={14} />
                    </Button>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </ScrollFade>
  );
}
