import {
  CheckCircle2,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  LoadingIndicator,
  PageHeader,
} from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { useRuntime } from "../services/runtime-context";
import { isTauri, cn } from "../lib/utils";
import { needsTwitchPermissionUpdate } from "../services/twitch/client";
import twitchIcon from "../assets/services/twitch.webp";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import obsIcon from "../assets/services/obs.svg";
import { useTranslation } from "react-i18next";
import type { DashboardItemId } from "../types";

const streamElementsTokenUrl =
  "https://streamelements.com/dashboard/account/channels";
const tipeeStreamTokenUrl = "https://www.tipeeestream.com/dashboard/api-key";

function RowAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-red-300"
    >
      {children}
    </button>
  );
}

function AddWidgetAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-accent transition hover:bg-accent/20"
    >
      <Plus size={13} />
      {children}
    </button>
  );
}

function phaseTone(phase: string) {
  return phase === "connected"
    ? "green"
    : phase === "connecting" || phase === "reconnecting"
      ? "amber"
      : phase === "error" || phase === "expired"
        ? "red"
        : ("neutral" as const);
}

function ServiceRow({
  name,
  icon,
  tint,
  phase,
  purpose,
  meta,
  error,
  action,
  children,
}: {
  name: string;
  icon: string;
  tint: string;
  phase: string;
  purpose: string;
  meta?: ReactNode;
  error?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            tint,
          )}
        >
          <img src={icon} alt="" className="size-5 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{name}</span>
            <Badge tone={phaseTone(phase)}>
              {t(`connectionPhases.${phase}`)}
            </Badge>
            {meta && (
              <span className="truncate text-[11px] text-zinc-600">{meta}</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted">{purpose}</div>
          {error && (
            <div className="mt-0.5 text-[11px] leading-4 text-red-300">
              {error}
            </div>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function TokenForm({
  id,
  label,
  placeholder,
  value,
  onChange,
  busy,
  disabled,
  onConnect,
  helpUrl,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  onConnect: () => Promise<void>;
  helpUrl: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl pb-3 pl-16 pr-4">
      <div className="flex gap-2">
        <input
          id={id}
          className="input"
          type="password"
          autoComplete="off"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim() && !disabled && !busy) {
              void onConnect();
            }
          }}
        />
        <Button
          variant="primary"
          disabled={!value.trim() || disabled || busy}
          onClick={() => void onConnect()}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          {t("connections.connect")}
        </Button>
      </div>
      <button
        type="button"
        onClick={() => void openUrl(helpUrl)}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-accent hover:brightness-125"
      >
        <ExternalLink size={11} />
        {t("connections.openTokenInstructions")}
      </button>
    </div>
  );
}

function ObsForm({
  address,
  onAddressChange,
  password,
  onPasswordChange,
  busy,
  disabled,
  onConnect,
}: {
  address: string;
  onAddressChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  disabled: boolean;
  onConnect: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl pb-3 pl-16 pr-4">
      <div className="flex gap-2">
        <div className="w-44 shrink-0">
          <input
            className="input"
            autoComplete="off"
            spellCheck={false}
            aria-label={t("connections.obsAddress")}
            placeholder="127.0.0.1:4455"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
          />
        </div>
        <input
          className="input min-w-0 flex-1"
          type="password"
          autoComplete="off"
          aria-label={t("connections.obsPassword")}
          placeholder={t("connections.obsPasswordPlaceholder")}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !disabled && !busy)
              void onConnect();
          }}
        />
        <Button
          className="shrink-0 whitespace-nowrap"
          variant="primary"
          disabled={disabled || busy}
          onClick={() => void onConnect()}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          {t("connections.connectObs")}
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-zinc-600">
        {t("connections.obsHint")}
      </p>
    </div>
  );
}

export function Connections() {
  const { t } = useTranslation();
  const twitch = useAppStore((state) => state.twitch);
  const streamElements = useAppStore((state) => state.streamElements);
  const tipeeStream = useAppStore((state) => state.tipeeStream);
  const obs = useAppStore((state) => state.obs);
  const obsSnapshot = useAppStore((state) => state.obsSnapshot);
  const settings = useAppStore((state) => state.settings);
  const runtime = useRuntime();
  const [token, setToken] = useState("");
  const [tipeeeStreamKey, setTipeeeStreamKey] = useState("");
  const [obsAddress, setObsAddress] = useState(settings.obsAddress);
  const [obsPassword, setObsPassword] = useState("");
  const twitchBusy = ["connecting", "reconnecting"].includes(twitch.phase);
  const seBusy = ["connecting", "reconnecting"].includes(streamElements.phase);
  const tipeeStreamBusy = ["connecting", "reconnecting"].includes(
    tipeeStream.phase,
  );
  const obsBusy = ["connecting", "reconnecting"].includes(obs.phase);
  const missingModeration =
    twitch.phase === "connected" && needsTwitchPermissionUpdate(twitch.scopes);
  const obsWidgetAdded = settings.dashboardWidgets.includes("obs");
  const addObsWidget = () => {
    if (obsWidgetAdded) return;
    const next: DashboardItemId[] = [...settings.dashboardWidgets, "obs"];
    useAppStore.getState().setSettings({ dashboardWidgets: next });
    void saveSetting("dashboardWidgets", next).catch(() =>
      toast.error(t("dashboard.layoutSaveError")),
    );
    toast.success(t("connections.obsWidgetAdded"));
    useAppStore.getState().setPage("dashboard");
  };

  return (
    <>
      <PageHeader
        icon={Link2}
        title={t("connections.title")}
        description={t("pageDescriptions.connections")}
      />
      <Card className="max-w-4xl divide-y divide-line overflow-hidden">
        <ServiceRow
          name="Twitch"
          icon={twitchIcon}
          tint="bg-[#9146ff]/10"
          phase={twitch.phase}
          purpose={t("connections.twitchPurpose")}
          meta={
            twitchBusy && !twitch.account ? (
              <LoadingIndicator className="h-2.5 w-24" />
            ) : (
              twitch.account
            )
          }
          error={twitch.detail}
          action={
            <>
              {missingModeration && (
                <Button
                  variant="primary"
                  onClick={runtime.reauthorizeTwitch}
                >
                  <ShieldCheck size={14} />
                  {t("connections.updatePermissions")}
                </Button>
              )}
              {twitch.phase === "connected" ? (
                <RowAction onClick={runtime.disconnectTwitch}>
                  {t("connections.disconnect")}
                </RowAction>
              ) : (
                <Button
                  variant="primary"
                  disabled={twitchBusy || !isTauri()}
                  onClick={runtime.connectTwitch}
                >
                  {twitchBusy ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <Link2 size={15} />
                  )}
                  {t("connections.connectTwitch")}
                </Button>
              )}
            </>
          }
        >
          {missingModeration && (
            <p className="pb-3 pl-16 pr-4 text-xs text-amber-300">
              {t("connections.reconnectModeration")}
            </p>
          )}
          {runtime.deviceAuth && (
            <div className="mb-3 ml-16 mr-4 flex flex-wrap items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/6 px-3 py-2">
              <span className="font-mono text-lg font-semibold tracking-[.16em]">
                {runtime.deviceAuth.code}
              </span>
              <Button
                className="ml-auto"
                onClick={() => void openUrl(runtime.deviceAuth!.url)}
              >
                <ExternalLink size={14} />
                {t("connections.openActivation")}
              </Button>
            </div>
          )}
        </ServiceRow>

        <ServiceRow
          name="StreamElements"
          icon={streamElementsIcon}
          tint="bg-cyan-400/10"
          phase={streamElements.phase}
          purpose={t("connections.streamElementsPurpose")}
          error={streamElements.detail}
          action={
            streamElements.phase === "connected" ? (
              <RowAction onClick={runtime.disconnectStreamElements}>
                {t("connections.disconnect")}
              </RowAction>
            ) : streamElements.phase === "error" ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={() => void runtime.retryStreamElements()}>
                  <RefreshCw size={14} />
                  {t("connections.retry")}
                </Button>
                <RowAction onClick={runtime.disconnectStreamElements}>
                  {t("connections.removeConnection")}
                </RowAction>
              </div>
            ) : streamElements.phase === "reconnecting" ? (
              <RowAction onClick={runtime.disconnectStreamElements}>
                {t("connections.cancelConnection")}
              </RowAction>
            ) : undefined
          }
        >
          {streamElements.phase === "disconnected" && (
            <TokenForm
              id="se-token"
              label={t("onboarding.jwtLabel")}
              placeholder={t("connections.jwtPlaceholder")}
              value={token}
              onChange={setToken}
              busy={seBusy}
              disabled={!isTauri()}
              onConnect={async () => {
                await runtime.connectStreamElements(token);
                setToken("");
              }}
              helpUrl={streamElementsTokenUrl}
            />
          )}
        </ServiceRow>

        <ServiceRow
          name="TipeeeStream"
          icon={tipeeStreamIcon}
          tint="bg-rose-400/10"
          phase={tipeeStream.phase}
          purpose={t("connections.tipeeStreamPurpose")}
          error={tipeeStream.detail}
          action={
            tipeeStream.phase === "error" ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button onClick={() => void runtime.retryTipeeeStream()}>
                  <RefreshCw size={14} />
                  {t("connections.retry")}
                </Button>
                <RowAction onClick={runtime.disconnectTipeeeStream}>
                  {t("connections.removeConnection")}
                </RowAction>
              </div>
            ) : tipeeStream.phase !== "disconnected" ? (
              <RowAction onClick={runtime.disconnectTipeeeStream}>
                {tipeeStreamBusy
                  ? t("connections.cancelConnection")
                  : tipeeStream.phase === "connected"
                    ? t("connections.disconnect")
                    : t("connections.removeConnection")}
              </RowAction>
            ) : undefined
          }
        >
          {tipeeStream.phase === "disconnected" && (
            <TokenForm
              id="tipeeestream-key"
              label={t("connections.tipeeStreamApiKey")}
              placeholder={t("connections.tipeeStreamApiKeyPlaceholder")}
              value={tipeeeStreamKey}
              onChange={setTipeeeStreamKey}
              busy={tipeeStreamBusy}
              disabled={!isTauri()}
              onConnect={async () => {
                await runtime.connectTipeeeStream(tipeeeStreamKey);
                setTipeeeStreamKey("");
              }}
              helpUrl={tipeeStreamTokenUrl}
            />
          )}
        </ServiceRow>

        <ServiceRow
          name="OBS"
          icon={obsIcon}
          tint="bg-zinc-300/10"
          phase={obs.phase}
          purpose={t("connections.obsPurpose")}
          meta={
            obs.phase === "connected"
              ? (obsSnapshot?.scene ?? obsSnapshot?.version)
              : obs.phase === "reconnecting"
                ? obs.detail
                : undefined
          }
          error={
            obs.phase === "error" || obs.phase === "expired"
              ? obs.detail
              : undefined
          }
          action={
            obs.phase !== "disconnected" ? (
              <div className="flex shrink-0 items-center gap-1">
                {obs.phase === "connected" && !obsWidgetAdded && (
                  <AddWidgetAction onClick={addObsWidget}>
                    {t("connections.addObsWidget")}
                  </AddWidgetAction>
                )}
                {obs.phase === "error" && (
                  <Button onClick={() => void runtime.retryObs()}>
                    <RefreshCw size={14} />
                    {t("connections.retry")}
                  </Button>
                )}
                <RowAction onClick={runtime.disconnectObs}>
                  {t("connections.disconnect")}
                </RowAction>
              </div>
            ) : undefined
          }
        >
          {obs.phase !== "connected" && !obsBusy && (
            <ObsForm
              address={obsAddress}
              onAddressChange={setObsAddress}
              password={obsPassword}
              onPasswordChange={setObsPassword}
              busy={obsBusy}
              disabled={!isTauri()}
              onConnect={async () => {
                await runtime.connectObs(obsAddress, obsPassword);
                setObsPassword("");
              }}
            />
          )}
        </ServiceRow>
      </Card>
    </>
  );
}
