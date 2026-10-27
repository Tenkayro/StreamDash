import { enable, disable } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Languages,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MonitorUp,
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
import type { AppLanguage, AppSettings, ConnectionPhase } from "../types";
import { Button, LoadingIndicator } from "./ui";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import obsIcon from "../assets/services/obs.svg";
import twitchIcon from "../assets/services/twitch.webp";

const streamElementsTokenUrl =
  "https://streamelements.com/dashboard/account/channels";
const tipeeStreamTokenUrl = "https://www.tipeeestream.com/dashboard/api-key";

const languages: Array<{ value: AppLanguage; label: string }> = [  { value: "auto", label: "common.automatic" },
  { value: "en", label: "languages.en" },
  { value: "de", label: "languages.de" },
  { value: "es", label: "languages.es" },
  { value: "pt-BR", label: "languages.pt-BR" },
  { value: "fr", label: "languages.fr" },
];

function SetupToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      data-state={value ? "on" : "off"}
      onClick={() => onChange(!value)}
      className="toggle-switch relative h-5 w-9 shrink-0 rounded-full transition-colors"
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[left] ${value ? "left-4.5" : "left-0.5"}`} />
    </button>
  );
}

function ChoiceRow({ icon: Icon, title, detail, children }: { icon: LucideIcon; title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-black/10 p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-muted">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function IntegrationRow({
  icon,
  tint,
  name,
  phase,
  error,
  helpUrl,
  children,
}: {
  icon: string;
  tint: string;
  name: string;
  phase: ConnectionPhase;
  error?: string;
  helpUrl?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const connected = phase === "connected";
  const failed = phase === "error" || phase === "expired";
  return (
    <div className="rounded-xl border border-line bg-black/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", tint)}>
          <img src={icon} alt="" className="size-4 object-contain" />
        </span>
        <span className="shrink-0 text-xs font-medium">{name}</span>
        {connected ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-emerald-300">
            <CheckCircle2 size={12} />
            {t("connectionPhases.connected")}
          </span>
        ) : (
          helpUrl && (
            <button
              type="button"
              onClick={() => void openUrl(helpUrl)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] text-accent hover:brightness-125"
            >
              <ExternalLink size={10} />
              {t("connections.openTokenInstructions")}
            </button>
          )
        )}
      </div>
      {connected ? null : (
        <>
          <div className="mt-2 flex items-center gap-1.5">{children}</div>
          {failed && error && (
            <p className="mt-1.5 text-[10px] leading-4 text-red-300">{error}</p>
          )}
        </>
      )}
    </div>
  );
}

export function SetupWizard() {
  const { t, i18n } = useTranslation();
  const runtime = useRuntime();
  const { settings, setSettings, twitch, streamElements, tipeeStream, obs } =
    useAppStore();
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

  const update = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const previous = settings[key];
    setSettings({ [key]: value });
    try {
      if (key === "launchAtStartup" && isTauri()) await (value ? enable() : disable());
      await saveSetting(key, value);
    } catch (error) {
      setSettings({ [key]: previous });
      toast.error(t("settings.saveError"), { description: errorMessage(error) });
    }
  };

  const selectLanguage = (language: AppLanguage) => {
    void update("language", language);
    const resolved = resolveLanguage(language);
    void i18n.changeLanguage(resolved);
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
      toast.error(t("onboarding.finishError"), { description: errorMessage(error) });
    }
  };

  const content = [
    <div key="language">
      <div className="mb-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <Languages size={27} />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{t("onboarding.languageTitle")}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{t("onboarding.languageBody")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {languages.map((language) => {
          const selected = settings.language === language.value;
          return (
            <button
              type="button"
              key={language.value}
              onClick={() => selectLanguage(language.value)}
              className={`relative rounded-xl border p-4 text-left transition ${selected ? "border-accent bg-accent-soft text-white" : "border-line bg-black/10 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"}`}
            >
              <div className="text-sm font-medium">{t(language.label)}</div>
              {language.value === "auto" && (
                <div className="mt-1 text-[10px] text-muted">{t("onboarding.detectedLanguage", { language: t(`languages.${resolveLanguage("auto")}`) })}</div>
              )}
              {selected && <Check size={14} className="absolute right-3 top-3 text-accent" />}
            </button>
          );
        })}
      </div>
    </div>,
    <div key="twitch">
      <div className="mb-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#9146ff]/12">
          <img src={twitchIcon} alt="" className="size-8 object-contain" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{t("onboarding.twitchTitle")}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{t("onboarding.twitchBody")}</p>
      </div>
      {twitch.phase === "connected" ? (
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-400/7 p-4">
          <CheckCircle2 size={22} className="text-emerald-400" />
          <div>
            <div className="text-sm font-medium text-emerald-200">{t("onboarding.connectedAs", { account: twitch.account })}</div>
            <div className="mt-0.5 text-xs text-muted">{t("onboarding.twitchConnectedDetail")}</div>
          </div>
        </div>
      ) : runtime.deviceAuth ? (
        <div className="mx-auto max-w-md rounded-xl border border-accent/35 bg-accent-soft p-5 text-center">
          <div className="text-xs text-muted">{t("connections.enterCode")}</div>
          <div className="mt-3 font-mono text-3xl font-semibold tracking-[.18em]">{runtime.deviceAuth.code}</div>
          <Button className="mt-4" onClick={() => void openUrl(runtime.deviceAuth!.url)}>
            <ExternalLink size={14} />
            {t("connections.openActivation")}
          </Button>
        </div>
      ) : (
        <div className="text-center">
          <Button variant="primary" disabled={!isTauri() || twitch.phase === "connecting"} onClick={() => void runtime.connectTwitch()}>
            {twitch.phase === "connecting" ? <LoaderCircle size={15} className="animate-spin" /> : <Link2 size={15} />}
            {t("connections.connectTwitch")}
          </Button>
          <p className="mx-auto mt-3 max-w-sm text-xs leading-5 text-zinc-600">{t("onboarding.twitchOptional")}</p>
        </div>
      )}
    </div>,
    <div key="integrations">
      <div className="mb-4 text-center">
        <div className="mx-auto flex items-center justify-center gap-2">
          {[
            { icon: streamElementsIcon, tint: "bg-cyan-400/10" },
            { icon: tipeeStreamIcon, tint: "bg-rose-400/10" },
            { icon: obsIcon, tint: "bg-zinc-300/10" },
          ].map(({ icon, tint }) => (
            <span
              key={icon}
              className={cn(
                "grid size-11 place-items-center rounded-2xl",
                tint,
              )}
            >
              <img src={icon} alt="" className="size-6 object-contain" />
            </span>
          ))}
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-.03em]">{t("onboarding.integrationsTitle")}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">{t("onboarding.integrationsBody")}</p>
      </div>
      <div className="mx-auto max-w-xl space-y-1.5">
        <IntegrationRow
          icon={streamElementsIcon}
          tint="bg-cyan-400/10"
          name="StreamElements"
          phase={streamElements.phase}
          error={streamElements.detail}
          helpUrl={streamElementsTokenUrl}
        >
          <input
            id="setup-se-token"
            className="input min-w-0 text-xs"
            type="password"
            autoComplete="off"
            aria-label={t("onboarding.jwtLabel")}
            placeholder={t("connections.jwtPlaceholder")}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && token.trim() && !streamElementsBusy && isTauri())
                void connectStreamElements();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={!token.trim() || streamElementsBusy || !isTauri()}
            onClick={() => void connectStreamElements()}
          >
            {streamElementsBusy ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>
        <IntegrationRow
          icon={tipeeStreamIcon}
          tint="bg-rose-400/10"
          name="TipeeeStream"
          phase={tipeeStream.phase}
          error={tipeeStream.detail}
          helpUrl={tipeeStreamTokenUrl}
        >
          <input
            id="setup-tipee-key"
            className="input min-w-0 text-xs"
            type="password"
            autoComplete="off"
            aria-label={t("connections.tipeeStreamApiKey")}
            placeholder={t("connections.tipeeStreamApiKeyPlaceholder")}
            value={tipeeStreamKey}
            onChange={(event) => setTipeeeStreamKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && tipeeStreamKey.trim() && !tipeeStreamBusy && isTauri())
                void connectTipeeeStream();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={!tipeeStreamKey.trim() || tipeeStreamBusy || !isTauri()}
            onClick={() => void connectTipeeeStream()}
          >
            {tipeeStreamBusy ? <LoaderCircle size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>
        <IntegrationRow
          icon={obsIcon}
          tint="bg-zinc-300/10"
          name="OBS"
          phase={obs.phase}
          error={obs.detail}
        >
          <div className="w-36 shrink-0">
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
              if (event.key === "Enter" && !obsBusy && isTauri()) void connectObs();
            }}
          />
          <Button
            className="shrink-0 whitespace-nowrap px-3 text-xs"
            variant="primary"
            disabled={obsBusy || !isTauri()}
            onClick={() => void connectObs()}
          >
            {obsBusy ? <LoaderCircle size={14} className="animate-spin" /> : <Link2 size={14} />}
            {t("connections.connect")}
          </Button>
        </IntegrationRow>
      </div>
    </div>,
    <div key="preferences">
      <div className="mb-6 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          <ShieldCheck size={27} />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-.03em]">{t("onboarding.preferencesTitle")}</h1>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{t("onboarding.preferencesBody")}</p>
      </div>
      <div className="space-y-2">
        <ChoiceRow icon={MonitorUp} title={t("settings.launchWithWindows")} detail={t("settings.launchWithWindowsDetail")}>
          <SetupToggle value={settings.launchAtStartup} onChange={(value) => void update("launchAtStartup", value)} />
        </ChoiceRow>
        <ChoiceRow icon={PanelBottom} title={t("settings.minimizeToTray")} detail={t("settings.minimizeToTrayDetail")}>
          <SetupToggle value={settings.minimizeToTray} onChange={(value) => void update("minimizeToTray", value)} />
        </ChoiceRow>
        <ChoiceRow icon={Bell} title={t("settings.windowsNotifications")} detail={t("settings.windowsNotificationsDetail")}>
          <SetupToggle value={settings.notifications} onChange={(value) => void update("notifications", value)} />
        </ChoiceRow>
      </div>
    </div>,
    <div key="ready" className="text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-400">
        <Sparkles size={30} />
      </span>
      <h1 className="mt-5 text-3xl font-semibold tracking-[-.04em]">{t("onboarding.readyTitle")}</h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">{t("onboarding.readyBody")}</p>
      <div className="mx-auto mt-6 grid max-w-lg grid-cols-2 gap-2 text-left">
        <div className="rounded-xl border border-line bg-black/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">{t("onboarding.languageSummary")}</div>
          <div className="mt-1 text-sm">{settings.language === "auto" ? t("common.automatic") : t(`languages.${settings.language}`)}</div>
        </div>
        <div className="rounded-xl border border-line bg-black/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">Twitch</div>
          <div className="mt-1 text-sm">{twitch.phase === "connected" ? twitch.account : t("connectionPhases.disconnected")}</div>
        </div>
      </div>
      <Button className="mt-7" variant="primary" disabled={finishing} onClick={() => void finish()}>
        {finishing ? <LoadingIndicator className="h-4 w-8" /> : <LayoutDashboard size={16} />}
        {t("onboarding.start")}
      </Button>
    </div>,
  ];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#0b0c0f] p-4 sm:p-8">
      <div className="mx-auto grid min-h-full max-w-5xl place-items-center">
        <div className="grid w-full overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/35 md:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="border-b border-line bg-black/10 p-5 md:border-b-0 md:border-r">
            <img src="/streamdash-logo-boot.webp" alt="StreamDash" className="h-auto w-40 max-w-full object-contain" />
            <div className="mt-7 flex gap-2 overflow-x-auto md:block md:space-y-1">
              {steps.map(({ icon: Icon, label }, index) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => index <= step && setStep(index)}
                  disabled={index > step}
                  className={`flex min-w-max items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition md:w-full ${index === step ? "bg-accent-soft text-accent" : index < step ? "text-zinc-300 hover:bg-white/4" : "text-zinc-700"}`}
                >
                  <span className={`grid size-6 place-items-center rounded-full border ${index < step ? "border-emerald-500/40 bg-emerald-400/10 text-emerald-400" : index === step ? "border-accent/50" : "border-line"}`}>
                    {index < step ? <Check size={12} /> : <Icon size={12} />}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </aside>
          <section className="flex min-h-142.5 flex-col p-5 sm:p-8">
            <div className="flex-1">{content[step]}</div>
            <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
              <div>
                {step > 0 && step < steps.length - 1 && (
                  <Button onClick={() => setStep((current) => current - 1)}>
                    <ChevronLeft size={14} />
                    {t("onboarding.back")}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step < steps.length - 1 && (
                  <button type="button" className="px-2 text-xs text-zinc-600 hover:text-zinc-300" onClick={() => void finish()}>
                    {t("onboarding.skipSetup")}
                  </button>
                )}
                {step < steps.length - 1 && (
                  <Button variant="primary" onClick={() => setStep((current) => current + 1)}>
                    {step === 0 ? t("onboarding.continue") : t("onboarding.next")}
                    <ChevronRight size={14} />
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
