import {
  Activity,
  AudioLines,
  Circle,
  Clapperboard,
  Copy,
  Cpu,
  Gauge,
  Link2,
  Mic,
  Monitor,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Video,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card, EmptyState, PageHeader } from "../components/ui";
import { cn } from "../lib/utils";
import { formatObsTime } from "../services/obs/format";
import { spotifyOverlayNative, type SpotifyNowPlaying, type SpotifyOverlayInfo } from "../services/native";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";
import type { ObsAudioInput, ObsSnapshot } from "../types";

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "red" | "green" | "amber";
}) {
  const tones = {
    neutral: "bg-white/5 text-zinc-400",
    red: "bg-red-400/10 text-red-300",
    green: "bg-emerald-400/10 text-emerald-300",
    amber: "bg-amber-400/10 text-amber-300",
  };
  return (
    <Card className="flex min-w-0 items-center gap-3 p-4">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", tones[tone])}>
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600">{label}</div>
        <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-zinc-100">{value}</div>
        {detail && <div className="mt-0.5 truncate text-[10px] text-muted">{detail}</div>}
      </div>
    </Card>
  );
}

function ControlButton({
  icon: Icon,
  label,
  description,
  active,
  danger,
  busy,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  active?: boolean;
  danger?: boolean;
  busy?: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void onClick()}
      className={cn(
        "flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-wait disabled:opacity-60",
        active
          ? danger
            ? "border-red-400/30 bg-red-400/10"
            : "border-accent/30 bg-accent-soft"
          : "border-line bg-black/15 hover:border-accent/30 hover:bg-white/3",
      )}
    >
      <span className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg",
        active ? (danger ? "bg-red-400/15 text-red-300" : "bg-accent/15 text-accent") : "bg-white/5 text-zinc-400",
      )}>
        {busy ? <RefreshCw size={17} className="animate-spin" /> : <Icon size={17} />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-zinc-200">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-muted">{description}</span>
      </span>
    </button>
  );
}

function SectionTitle({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <Icon size={15} className="mt-0.5 shrink-0 text-accent" />
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-[11px] text-muted">{description}</p>
      </div>
    </div>
  );
}

function SpotifyOverlayCard() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SpotifyOverlayInfo>();
  const [status, setStatus] = useState<SpotifyNowPlaying>();
  useEffect(() => {
    let active = true;
    void spotifyOverlayNative.info().then((value) => { if (active) setInfo(value); }).catch(() => undefined);
    const refresh = () => void spotifyOverlayNative.status().then((value) => { if (active) setStatus(value); }).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const coverUrl = info && status?.hasCover ? `${new URL(info.url).origin}/cover?r=${status.revision}` : undefined;
  const copyUrl = async () => {
    if (!info) return;
    try { await navigator.clipboard.writeText(info.url); toast.success(t("obs.spotifyOverlay.copied")); }
    catch { toast.error(t("obs.spotifyOverlay.copyError")); }
  };
  return (
    <Card className="mt-3 p-4">
      <SectionTitle icon={Music2} title={t("obs.spotifyOverlay.title")} description={t("obs.spotifyOverlay.description")} />
      <div className="grid items-center gap-4 xl:grid-cols-[minmax(360px,1.1fr)_minmax(300px,.9fr)]">
        <div className="relative aspect-35/8 min-h-28 overflow-hidden rounded-2xl border border-white/10 bg-[#211e27] shadow-xl">
          {coverUrl && <div className="absolute -inset-8 scale-110 bg-cover bg-center opacity-30 blur-2xl" style={{ backgroundImage: `url(${JSON.stringify(coverUrl)})` }} />}
          <div className="absolute inset-0 bg-linear-to-r from-black/10 via-black/45 to-black/75" />
          <div className="relative grid h-full grid-cols-[min(23%,10rem)_1fr]">
            <div className="grid min-h-0 place-items-center overflow-hidden bg-white/5 text-[#1ed760]">
              {coverUrl ? <img src={coverUrl} alt="" className="size-full object-cover" /> : <Music2 size={34} />}
            </div>
            <div className="flex min-w-0 flex-col justify-center px-5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-[#1ed760]"><Music2 size={11} />Spotify</div>
              <div className="truncate text-[clamp(1rem,2vw,1.75rem)] font-extrabold tracking-tight text-white">{status?.available ? status.title : t("obs.spotifyOverlay.previewTitle")}</div>
              <div className="truncate text-[clamp(.75rem,1.4vw,1.1rem)] text-white/70">{status?.available ? status.artist || status.album : t("obs.spotifyOverlay.previewArtist")}</div>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div><div className="text-xs font-semibold text-zinc-200">{t("obs.spotifyOverlay.browserSource")}</div><div className="mt-0.5 text-[10px] text-muted">{t("obs.spotifyOverlay.size", { width: info?.width ?? 700, height: info?.height ?? 160 })}</div></div>
            <Badge tone={status?.available ? status.playing ? "green" : "amber" : "neutral"}>{t(status?.available ? status.playing ? "obs.spotifyOverlay.playing" : "obs.spotifyOverlay.paused" : "obs.spotifyOverlay.waiting")}</Badge>
          </div>
          <div className="flex gap-2"><input readOnly aria-label={t("obs.spotifyOverlay.urlLabel")} value={info?.url ?? ""} placeholder={t("obs.spotifyOverlay.desktopOnly")} className="input min-w-0 flex-1 font-mono text-[11px]" /><Button onClick={() => void copyUrl()} disabled={!info}><Copy size={14} />{t("obs.spotifyOverlay.copy")}</Button></div>
          <p className="mt-2 text-[10px] leading-4 text-muted">{t("obs.spotifyOverlay.hint")}</p>
        </div>
      </div>
    </Card>
  );
}

function AudioChannel({ input, busy, run }: {
  input: ObsAudioInput;
  busy: boolean;
  run: (key: string, action: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const Icon = input.kind === "mic" ? Mic : Monitor;
  const volume = Math.round(input.volume * 100);
  return (
    <div className="rounded-xl border border-line bg-black/15 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-400"><Icon size={15} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-zinc-200" title={input.name}>{input.name}</div>
          <div className="text-[10px] text-muted">{t(input.kind === "mic" ? "obs.mic" : "obs.desktop")}</div>
        </div>
        <span className="text-[11px] tabular-nums text-zinc-500">{input.muted ? t("obs.muted") : `${volume}%`}</span>
        <button
          type="button"
          disabled={busy}
          aria-label={t(input.muted ? "obs.unmute" : "obs.mute", { label: input.name })}
          aria-pressed={input.muted}
          onClick={() => void run(`mute:${input.name}`, () => runtime.setObsMute(input.name, !input.muted))}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg border transition disabled:opacity-60",
            input.muted ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-line text-zinc-400 hover:text-zinc-100",
          )}
        >
          {input.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <VolumeX size={12} className="shrink-0 text-zinc-600" />
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          aria-label={t("obs.page.volume", { name: input.name })}
          disabled={busy}
          onChange={(event) => void runtime.setObsVolume(input.name, Number(event.target.value) / 100)}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-(--accent)"
        />
        <Volume2 size={12} className="shrink-0 text-zinc-600" />
        <span className="w-14 text-right text-[10px] tabular-nums text-zinc-600">{input.volumeDb.toFixed(1)} dB</span>
      </div>
    </div>
  );
}

function ObsWorkspace({ snapshot }: { snapshot: ObsSnapshot }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const settings = useAppStore((state) => state.settings);
  const [busy, setBusy] = useState<string[]>([]);
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy.includes(key)) return;
    setBusy((value) => [...value, key]);
    try { await action(); } finally { setBusy((value) => value.filter((entry) => entry !== key)); }
  };
  const outputDescription = (active: boolean) => t(active ? "obs.page.active" : "obs.page.inactive");

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Radio} label={t("obs.page.streamOutput")} value={snapshot.streaming ? formatObsTime(snapshot.streamSeconds) : t("obs.page.inactive")} detail={snapshot.streaming && snapshot.streamBitrate ? `${snapshot.streamBitrate.toLocaleString()} kbit/s` : undefined} tone={snapshot.streaming ? "red" : "neutral"} />
        <Metric icon={Circle} label={t("obs.page.recordingOutput")} value={snapshot.recording ? formatObsTime(snapshot.recordingSeconds) : t("obs.page.inactive")} detail={snapshot.recordingPaused ? t("obs.recordingPaused") : undefined} tone={snapshot.recording ? "red" : "neutral"} />
        <Metric icon={Gauge} label={t("obs.page.performance")} value={snapshot.fps ? `${snapshot.fps.toFixed(1)} FPS` : "—"} detail={snapshot.cpu != null ? t("obs.page.cpuValue", { value: snapshot.cpu.toFixed(1) }) : undefined} tone={snapshot.cpu != null && snapshot.cpu > 80 ? "amber" : "green"} />
        <Metric icon={Activity} label={t("obs.page.droppedFrames")} value={(snapshot.streamDropped ?? 0).toLocaleString()} detail={snapshot.scene ? t("obs.page.currentScene", { scene: snapshot.scene }) : undefined} tone={snapshot.streamDropped ? "amber" : "green"} />
      </div>

      <Card className="mt-3 p-4">
        <SectionTitle icon={Settings2} title={t("obs.page.outputControls")} description={t("obs.page.outputControlsDescription")} />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <ControlButton icon={Radio} label={t(snapshot.streaming ? "obs.stopStream" : "obs.startStream")} description={outputDescription(snapshot.streaming)} active={snapshot.streaming} danger busy={busy.includes("stream")} onClick={() => run("stream", () => runtime.setObsStreaming(!snapshot.streaming))} />
          <ControlButton icon={Circle} label={t(snapshot.recording ? "obs.stopRecording" : "obs.startRecording")} description={outputDescription(snapshot.recording)} active={snapshot.recording} danger busy={busy.includes("recording")} onClick={() => run("recording", () => runtime.setObsRecording(!snapshot.recording))} />
          <ControlButton icon={snapshot.recordingPaused ? Play : Pause} label={t(snapshot.recordingPaused ? "obs.resumeRecording" : "obs.pauseRecording")} description={snapshot.recording ? t(snapshot.recordingPaused ? "obs.page.paused" : "obs.page.running") : t("obs.page.recordingRequired")} active={snapshot.recordingPaused} busy={busy.includes("pause")} onClick={() => snapshot.recording ? run("pause", () => runtime.setObsRecordingPaused(!snapshot.recordingPaused)) : Promise.resolve()} />
          <ControlButton icon={Video} label={t(snapshot.virtualCam ? "obs.stopVirtualCam" : "obs.startVirtualCam")} description={outputDescription(snapshot.virtualCam)} active={snapshot.virtualCam} busy={busy.includes("camera")} onClick={() => run("camera", () => runtime.setObsVirtualCam(!snapshot.virtualCam))} />
          <ControlButton icon={RotateCcw} label={t(snapshot.replayBuffer ? "obs.stopReplayBuffer" : "obs.startReplayBuffer")} description={outputDescription(snapshot.replayBuffer)} active={snapshot.replayBuffer} busy={busy.includes("replay")} onClick={() => run("replay", () => runtime.setObsReplayBuffer(!snapshot.replayBuffer))} />
          <ControlButton icon={Save} label={t("obs.saveReplay")} description={snapshot.replayBuffer ? t("obs.page.saveReplayDescription") : t("obs.page.replayRequired")} busy={busy.includes("save-replay")} onClick={() => snapshot.replayBuffer ? run("save-replay", runtime.saveObsReplayBuffer) : Promise.resolve()} />
        </div>
      </Card>

      <div className="mt-3 grid items-start gap-3 xl:grid-cols-[minmax(260px,.8fr)_minmax(360px,1.2fr)]">
        <Card className="p-4">
          <SectionTitle icon={Clapperboard} title={t("obs.page.scenes")} description={t("obs.page.scenesDescription")} />
          {snapshot.scenes.length ? (
            <div className="grid max-h-96 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {snapshot.scenes.map((scene) => {
                const active = scene === snapshot.scene;
                return <button key={scene} type="button" aria-pressed={active} onClick={() => void run(`scene:${scene}`, () => runtime.setObsScene(scene))} className={cn("flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition", active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-black/15 text-zinc-400 hover:border-accent/30 hover:text-zinc-100")}><span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-accent" : "bg-zinc-700")} /><span className="truncate">{scene}</span>{active && <Badge tone="purple">{t("obs.page.program")}</Badge>}</button>;
              })}
            </div>
          ) : <p className="text-xs text-muted">{t("obs.page.noScenes")}</p>}
        </Card>

        <Card className="p-4">
          <SectionTitle icon={AudioLines} title={t("obs.page.audioMixer")} description={t("obs.page.audioMixerDescription")} />
          {snapshot.audio.length ? <div className="grid gap-2">{snapshot.audio.map((input) => <AudioChannel key={input.name} input={input} busy={busy.includes(`mute:${input.name}`)} run={run} />)}</div> : <p className="text-xs text-muted">{t("obs.page.noAudio")}</p>}
        </Card>
      </div>

      <Card className="mt-3 p-4">
        <SectionTitle icon={Cpu} title={t("obs.page.details")} description={t("obs.page.detailsDescription")} />
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t("obs.page.version"), snapshot.version ? `OBS ${snapshot.version}` : "—"],
            [t("obs.page.profile"), snapshot.profile ?? "—"],
            [t("obs.page.sceneCollection"), snapshot.sceneCollection ?? "—"],
            [t("obs.page.websocketAddress"), settings.obsAddress],
          ].map(([label, value]) => <div key={label}><dt className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">{label}</dt><dd className="mt-1 truncate text-xs text-zinc-300" title={value}>{value}</dd></div>)}
        </dl>
      </Card>
    </>
  );
}

export function ObsPage() {
  const { t } = useTranslation();
  const obs = useAppStore((state) => state.obs);
  const snapshot = useAppStore((state) => state.obsSnapshot);
  const setPage = useAppStore((state) => state.setPage);
  const runtime = useRuntime();
  const connected = obs.phase === "connected" && snapshot;
  return (
    <>
      <PageHeader
        icon={Clapperboard}
        title={t("obs.title")}
        description={t("pageDescriptions.obs")}
        titleActions={<Badge tone={obs.phase === "connected" ? "green" : obs.phase === "reconnecting" || obs.phase === "connecting" ? "amber" : obs.phase === "error" ? "red" : "neutral"}>{t(`connectionPhases.${obs.phase}`)}</Badge>}
        actions={<Button onClick={() => setPage("connections")}><Link2 size={14} />{t("obs.page.connectionSettings")}</Button>}
      />
      {connected ? <ObsWorkspace snapshot={snapshot} /> : (
        <Card>
          <EmptyState
            icon={<Clapperboard size={28} />}
            title={t("obs.page.notConnected")}
            body={obs.detail ?? t(obs.phase === "connecting" || obs.phase === "reconnecting" ? "obs.connectingHint" : "obs.page.notConnectedDescription")}
            action={obs.phase === "error" ? <Button variant="primary" onClick={() => void runtime.retryObs()}><RefreshCw size={14} />{t("connections.retry")}</Button> : <Button variant="primary" onClick={() => setPage("connections")}><Link2 size={14} />{t("obs.openConnection")}</Button>}
          />
        </Card>
      )}
      <SpotifyOverlayCard />
    </>
  );
}
