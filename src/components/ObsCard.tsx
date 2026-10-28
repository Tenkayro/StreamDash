import { Circle, Link2, Mic, Monitor, Pause, Play, Radio, RotateCcw, Save, Video, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card } from "./ui";
import { cn } from "../lib/utils";
import { formatObsTime } from "../services/obs/format";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import type { ConnectionPhase, ObsAudioInput, ObsSnapshot } from "../types";
import obsIcon from "../assets/services/obs.svg";

function obsPhaseDot(phase: ConnectionPhase) {
  return phase === "connected"
    ? "bg-emerald-400"
    : phase === "connecting" || phase === "reconnecting"
      ? "bg-amber-400"
      : phase === "error" || phase === "expired"
        ? "bg-red-400"
        : "bg-zinc-600";
}

export function ObsStatusLine({ snapshot }: { snapshot: ObsSnapshot }) {
  const { t } = useTranslation();
  const streaming = snapshot.streaming;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          streaming ? "bg-red-400" : "bg-zinc-500",
        )}
      />
      <span className="truncate">
        {streaming
          ? t("obs.streaming")
          : snapshot.recording
            ? snapshot.recordingPaused
              ? t("obs.recordingPaused")
              : t("obs.recording")
            : t("obs.idle")}
      </span>
      {(streaming || snapshot.recording) && (
        <span className="shrink-0 tabular-nums text-zinc-500">
          {formatObsTime(
            streaming
              ? snapshot.streamSeconds
              : snapshot.recordingSeconds,
          )}
        </span>
      )}
    </div>
  );
}

export function ObsSceneSelect({ snapshot }: { snapshot: ObsSnapshot }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  if (!snapshot.scenes.length)
    return <span className="truncate text-xs">{snapshot.scene ?? "—"}</span>;
  return (
    <select
      aria-label={t("obs.scene")}
      className="input h-7 max-w-38 px-1.5 py-0 text-xs"
      value={snapshot.scene ?? ""}
      onChange={(event) => void runtime.setObsScene(event.target.value)}
    >
      {snapshot.scenes.map((scene) => (
        <option key={scene} value={scene}>
          {scene}
        </option>
      ))}
    </select>
  );
}

export function ObsAudioButton({ input }: { input: ObsAudioInput }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const label = input.kind === "mic" ? t("obs.mic") : t("obs.desktop");
  const Icon = input.kind === "mic" ? Mic : Monitor;
  return (
    <button
      type="button"
      onClick={() => void runtime.setObsMute(input.name, !input.muted)}
      title={`${input.name} · ${Math.round(input.volume * 100)}%`}
      aria-label={t(input.muted ? "obs.unmute" : "obs.mute", { label })}
      aria-pressed={input.muted}
      className={cn(
        "inline-flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 text-[11px] transition",
        input.muted
          ? "border-red-400/30 bg-red-400/10 text-red-300"
          : "border-line bg-black/15 text-zinc-300 hover:border-accent/30 hover:text-zinc-100",
      )}
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-500">
        {input.muted ? t("obs.muted") : `${Math.round(input.volume * 100)}%`}
      </span>
    </button>
  );
}

function ObsMeta({ snapshot }: { snapshot: ObsSnapshot }) {
  const details = [
    snapshot.version ? `OBS ${snapshot.version}` : undefined,
    snapshot.fps ? `${Math.round(snapshot.fps)} FPS` : undefined,
    snapshot.cpu ? `${snapshot.cpu.toFixed(1)}% CPU` : undefined,
  ].filter(Boolean);
  if (!details.length) return null;
  return (
    <div className="mt-3 truncate border-t border-line pt-2 text-[10px] text-zinc-600">
      {details.join(" · ")}
    </div>
  );
}

function ObsControl({
  icon: Icon,
  label,
  active = false,
  danger = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition",
        active
          ? danger
            ? "border-red-400/30 bg-red-400/10 text-red-200"
            : "border-accent/30 bg-accent-soft text-accent"
          : "border-line bg-black/15 text-zinc-400 hover:bg-white/3 hover:text-zinc-200",
      )}
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function ObsControls({ snapshot }: { snapshot: ObsSnapshot }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  return (
    <div className="grid grid-cols-2 gap-1.5 border-t border-line pt-2">
      <ObsControl
        icon={Radio}
        label={t(snapshot.streaming ? "obs.stopStream" : "obs.startStream")}
        active={snapshot.streaming}
        danger={snapshot.streaming}
        onClick={() => void runtime.setObsStreaming(!snapshot.streaming)}
      />
      <ObsControl
        icon={Circle}
        label={t(snapshot.recording ? "obs.stopRecording" : "obs.startRecording")}
        active={snapshot.recording}
        danger={snapshot.recording}
        onClick={() => void runtime.setObsRecording(!snapshot.recording)}
      />
      {snapshot.recording && (
        <ObsControl
          icon={snapshot.recordingPaused ? Play : Pause}
          label={t(snapshot.recordingPaused ? "obs.resumeRecording" : "obs.pauseRecording")}
          active={snapshot.recordingPaused}
          onClick={() => void runtime.setObsRecordingPaused(!snapshot.recordingPaused)}
        />
      )}
      <ObsControl
        icon={RotateCcw}
        label={t(snapshot.replayBuffer ? "obs.stopReplayBuffer" : "obs.startReplayBuffer")}
        active={snapshot.replayBuffer}
        onClick={() => void runtime.setObsReplayBuffer(!snapshot.replayBuffer)}
      />
      {snapshot.replayBuffer && (
        <ObsControl
          icon={Save}
          label={t("obs.saveReplay")}
          onClick={() => void runtime.saveObsReplayBuffer()}
        />
      )}
      <ObsControl
        icon={Video}
        label={t(snapshot.virtualCam ? "obs.stopVirtualCam" : "obs.startVirtualCam")}
        active={snapshot.virtualCam}
        onClick={() => void runtime.setObsVirtualCam(!snapshot.virtualCam)}
      />
    </div>
  );
}

export function ObsBody({ snapshot }: { snapshot: ObsSnapshot }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="mt-3 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t("obs.status")}</span>
          <ObsStatusLine snapshot={snapshot} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t("obs.bitrate")}</span>
          <span className="text-right tabular-nums text-zinc-300">
            {snapshot.streaming && snapshot.streamBitrate
              ? `${snapshot.streamBitrate.toLocaleString()} kbit/s`
              : "—"}
            {snapshot.streaming && (
              snapshot.streamDropped ? (
                <span className="ml-1 text-[10px] text-amber-300/80">
                  {t("obs.droppedFrames", {
                    count: snapshot.streamDropped,
                  })}
                </span>
              ) : null
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t("obs.scene")}</span>
          <ObsSceneSelect snapshot={snapshot} />
        </div>
        <ObsControls snapshot={snapshot} />
        {snapshot.audio.length > 0 && (
          <div className="flex items-center gap-1.5 pt-1">
            {snapshot.audio.map((input) => (
              <ObsAudioButton key={input.name} input={input} />
            ))}
          </div>
        )}
      </div>
      <ObsMeta snapshot={snapshot} />
    </>
  );
}

export function ObsCard() {
  const { t } = useTranslation();
  const obs = useAppStore((state) => state.obs);
  const snapshot = useAppStore((state) => state.obsSnapshot);
  const setPage = useAppStore((state) => state.setPage);
  const connected = obs.phase === "connected" && snapshot;

  return (
    <Card className="h-fit p-4">
      <div className="flex items-center gap-2">
        <img src={obsIcon} alt="" className="size-4 object-contain" />
        <h2 className="text-sm font-semibold">{t("obs.title")}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {snapshot?.replayBuffer && (
            <span title={t("obs.replayBuffer")} className="text-zinc-500">
              <RotateCcw size={11} />
            </span>
          )}
          {snapshot?.virtualCam && (
            <span title={t("obs.virtualCam")} className="text-zinc-500">
              <Video size={11} />
            </span>
          )}
          {obs.phase === "connected" && snapshot?.streaming && (
            <Badge tone="red">{t("obs.live")}</Badge>
          )}
          <span
            title={t(`connectionPhases.${obs.phase}`)}
            className={cn(
              "size-1.5 rounded-full",
              obsPhaseDot(obs.phase),
            )}
          />
        </div>
      </div>
      {connected ? (
        <ObsBody snapshot={snapshot} />
      ) : (
        <>
          <p className="mt-2 text-xs leading-5 text-muted">
            {obs.detail ??
              (obs.phase === "disconnected"
                ? t("obs.connectHint")
                : t("obs.connectingHint"))}
          </p>
          <Button
            className="mt-3 w-full"
            onClick={() => setPage("connections")}
          >
            <Link2 size={14} />
            {t("obs.openConnection")}
          </Button>
        </>
      )}
    </Card>
  );
}

export function ObsWidgetHeader() {
  const { t } = useTranslation();
  const setPage = useAppStore((state) => state.setPage);
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs font-semibold">
        <Radio size={14} className="text-accent" />
        {t("obs.title")}
      </div>
      <button
        className="text-[11px] text-accent hover:brightness-125"
        onClick={() => setPage("obs")}
      >
        {t("dashboard.manage")}
      </button>
    </div>
  );
}

export function ObsWidget() {
  const { t } = useTranslation();
  const obs = useAppStore((state) => state.obs);
  const snapshot = useAppStore((state) => state.obsSnapshot);
  const setPage = useAppStore((state) => state.setPage);

  return (
    <Card className="flex min-h-0 flex-col p-4">
      <ObsWidgetHeader />
      {obs.phase === "connected" && snapshot ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ObsBody snapshot={snapshot} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
          <img src={obsIcon} alt="" className="size-6 opacity-60" />
          <p className="max-w-56 text-[11px] leading-4 text-muted">
            {obs.detail ?? t("obs.connectHint")}
          </p>
          <button
            type="button"
            onClick={() => setPage("connections")}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:brightness-125"
          >
            <Video size={12} />
            {t("obs.openConnection")}
          </button>
        </div>
      )}
    </Card>
  );
}
