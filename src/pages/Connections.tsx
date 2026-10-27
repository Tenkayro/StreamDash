import {
  CheckCircle2,
  ExternalLink,
  Link2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Badge,
  Button,
  Card,
  LoadingIndicator,
  PageHeader,
} from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { useRuntime } from "../services/runtime-context";
import { isTauri } from "../lib/utils";
import { needsTwitchPermissionUpdate } from "../services/twitch/client";
import twitchIcon from "../assets/services/twitch.webp";
import streamElementsIcon from "../assets/services/streamelements.webp";
import tipeeStreamIcon from "../assets/services/tipeeestream.webp";
import { useTranslation } from "react-i18next";

function phaseTone(phase: string) {
  return phase === "connected"
    ? "green"
    : phase === "connecting" || phase === "reconnecting"
      ? "amber"
      : phase === "error" || phase === "expired"
        ? "red"
        : ("neutral" as const);
}

export function Connections() {
  const { t } = useTranslation();
  const { twitch, streamElements, tipeeStream } = useAppStore();
  const runtime = useRuntime();
  const [token, setToken] = useState("");
  const [tipeeeStreamKey, setTipeeeStreamKey] = useState("");
  const twitchBusy = ["connecting", "reconnecting"].includes(twitch.phase);
  const seBusy = ["connecting", "reconnecting"].includes(streamElements.phase);
  const tipeeStreamBusy = ["connecting", "reconnecting"].includes(tipeeStream.phase);
  const missingModeration =
    twitch.phase === "connected" && needsTwitchPermissionUpdate(twitch.scopes);
  return (
    <>
      <PageHeader
        icon={Link2}
        title={t("connections.title")}
        description={t("pageDescriptions.connections")}
      />
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-5">
            <div className="flex gap-4">
              <div className="grid size-11 place-items-center rounded-xl bg-[#9146ff]/10">
                <img
                  src={twitchIcon}
                  alt=""
                  className="size-7 object-contain"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Twitch</h2>
                  <Badge tone={phaseTone(twitch.phase)}>{t(`connectionPhases.${twitch.phase}`)}</Badge>
                </div>
                {twitchBusy && !twitch.account ? (
                  <LoadingIndicator className="mt-2 h-3.5 w-24" />
                ) : twitch.account ? (
                  <p className="mt-1 text-sm text-muted">{twitch.account}</p>
                ) : null}
                {twitch.detail && (
                  <p className="mt-2 text-xs text-red-300">{twitch.detail}</p>
                )}
                {missingModeration && (
                  <p className="mt-2 text-xs text-amber-300">
                    {t("connections.reconnectModeration")}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {missingModeration && (
                <Button variant="primary" onClick={runtime.reauthorizeTwitch}>
                  <ShieldCheck size={14} />
                  {t("connections.updatePermissions")}
                </Button>
              )}
              {twitch.phase === "connected" ? (
                <Button variant="danger" onClick={runtime.disconnectTwitch}>
                  {t("connections.disconnect")}
                </Button>
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
            </div>
          </div>
          {runtime.deviceAuth && (
            <div className="mt-5 rounded-xl border border-violet-500/30 bg-violet-500/6 p-4">
              <div className="text-xs text-muted">
                {t("connections.enterCode")}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-[.16em]">
                {runtime.deviceAuth.code}
              </div>
              <Button
                className="mt-3"
                onClick={() => openUrl(runtime.deviceAuth!.url)}
              >
                <ExternalLink size={14} />
                {t("connections.openActivation")}
              </Button>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex gap-4">
              <div className="grid size-11 place-items-center rounded-xl bg-cyan-400/10">
                <img
                  src={streamElementsIcon}
                  alt=""
                  className="size-7 object-contain"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">StreamElements</h2>
                  <Badge tone={phaseTone(streamElements.phase)}>
                    {t(`connectionPhases.${streamElements.phase}`)}
                  </Badge>
                </div>
                {streamElements.detail && (
                  <p className="mt-2 text-xs text-red-300">
                    {streamElements.detail}
                  </p>
                )}
              </div>
            </div>
            {streamElements.phase === "connected" ? (
              <Button
                variant="danger"
                onClick={runtime.disconnectStreamElements}
              >
                {t("connections.disconnect")}
              </Button>
            ) : null}
          </div>
          {streamElements.phase !== "connected" && (
            <div className="mt-5 max-w-2xl">
              <label className="label" htmlFor="se-token">
                StreamElements JWT
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="se-token"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={t("connections.jwtPlaceholder")}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={!token.trim() || seBusy || !isTauri()}
                  onClick={async () => {
                    await runtime.connectStreamElements(token);
                    setToken("");
                  }}
                >
                  {seBusy ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  {t("connections.connect")}
                </Button>
              </div>
              <button
                type="button"
                onClick={() =>
                  void openUrl(
                    "https://streamelements.com/dashboard/account/channels",
                  )
                }
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:brightness-125"
              >
                <ExternalLink size={12} />
                {t("connections.openTokenInstructions")}
              </button>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex gap-4">
              <div className="grid size-11 place-items-center rounded-xl bg-rose-400/10">
                <img
                  src={tipeeStreamIcon}
                  alt=""
                  className="size-7 object-contain"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">TipeeeStream</h2>
                  <Badge tone={phaseTone(tipeeStream.phase)}>{t(`connectionPhases.${tipeeStream.phase}`)}</Badge>
                </div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
                  {t("connections.tipeeStreamDetail")}
                </p>
                {tipeeStream.detail && <p className="mt-2 text-xs text-red-300">{tipeeStream.detail}</p>}
              </div>
            </div>
            {tipeeStream.phase !== "disconnected" && (
              <Button variant="danger" onClick={runtime.disconnectTipeeeStream}>
                {tipeeStreamBusy
                  ? t("connections.cancelConnection")
                  : tipeeStream.phase === "connected"
                    ? t("connections.disconnect")
                    : t("connections.removeConnection")}
              </Button>
            )}
          </div>
          {tipeeStream.phase !== "connected" && !tipeeStreamBusy && (
            <div className="mt-5 max-w-2xl">
              <label className="label" htmlFor="tipeeestream-key">{t("connections.tipeeStreamApiKey")}</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="tipeeestream-key"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder={t("connections.tipeeStreamApiKeyPlaceholder")}
                  value={tipeeeStreamKey}
                  onChange={(event) => setTipeeeStreamKey(event.target.value)}
                />
                <Button
                  variant="primary"
                  disabled={!tipeeeStreamKey.trim() || tipeeStreamBusy || !isTauri()}
                  onClick={async () => {
                    await runtime.connectTipeeeStream(tipeeeStreamKey);
                    setTipeeeStreamKey("");
                  }}
                >
                  {tipeeStreamBusy ? <LoaderCircle className="animate-spin" size={15} /> : <Link2 size={15} />}
                  {t("connections.connect")}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => void openUrl("https://www.tipeeestream.com/dashboard/api-key")}
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:brightness-125"
              >
                <ExternalLink size={12} />
                {t("connections.openTokenInstructions")}
              </button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
