import { TwitchPlayer } from "../components/TwitchPlayer";
import { Badge, Card, PageHeader } from "../components/ui";
import { useTranslation } from "react-i18next";
import { Activity, Clapperboard, Clock3, Cpu, Eye, Gauge, MonitorPlay, Radio, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "../stores/app-store";
import { useNetworkStore } from "../stores/network-store";
import { formatObsTime } from "../services/obs/format";

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-rule bg-well px-3 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-rule bg-panel text-muted"><Icon size={13} /></span>
      <div className="min-w-0"><div className="studio-label truncate">{label}</div><div className="mt-0.5 truncate studio-mono text-xs font-semibold text-ink-strong">{value}</div></div>
    </div>
  );
}

function streamDuration(startedAt?: string) {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1_000));
  return formatObsTime(seconds);
}

export function LivePreview() {
  const { t } = useTranslation();
  const stats = useAppStore((state) => state.stats);
  const twitch = useAppStore((state) => state.twitch);
  const obs = useAppStore((state) => state.obs);
  const snapshot = useAppStore((state) => state.obsSnapshot);
  const networkOnline = useNetworkStore((state) => state.online);
  const networkChecking = useNetworkStore((state) => state.checking);
  const checkNetworkNow = useNetworkStore((state) => state.checkNow);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!stats.live || !stats.startedAt) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [stats.live, stats.startedAt]);
  const performance = snapshot?.fps != null || snapshot?.cpu != null
    ? [snapshot?.fps != null ? `${snapshot.fps.toFixed(1)} FPS` : undefined, snapshot?.cpu != null ? `${snapshot.cpu.toFixed(1)}% CPU` : undefined].filter(Boolean).join(" · ")
    : "—";
  return (
    <>
      <PageHeader
        icon={MonitorPlay}
        title={t("nav.livePreview")}
        description={t("pageDescriptions.livePreview")}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2.5">
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[10px] border border-rule-strong bg-black shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
          {networkOnline ? (
            <TwitchPlayer className="aspect-video max-h-full max-w-full" />
          ) : (
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <div className="grid size-11 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300">
                <WifiOff size={20} aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{t("network.offlineTitle")}</p>
                <p className="mt-1 text-xs text-muted">{t("network.previewUnavailable")}</p>
              </div>
              <button
                type="button"
                disabled={networkChecking}
                onClick={() => void checkNetworkNow()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-hover px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-white/10 disabled:opacity-50"
              >
                <RefreshCw size={12} className={networkChecking ? "animate-spin" : undefined} aria-hidden="true" />
                <span>{t("network.retry")}</span>
              </button>
            </div>
          )}
        </div>
        <Card className="grid shrink-0 gap-2.5 p-2.5 lg:grid-cols-[minmax(240px,.7fr)_minmax(420px,1.3fr)]">
          <section className="border-b border-line p-2 lg:border-b-0 lg:border-r lg:pr-3">
            <div className="mb-1.5 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-muted"><Radio size={12} className="text-twitch" />Twitch</div><Badge tone={stats.live ? "green" : twitch.phase === "connected" ? "neutral" : "amber"}>{stats.live ? t("stream.live") : twitch.phase === "connected" ? t("stream.offline") : t(`connectionPhases.${twitch.phase}`)}</Badge></div>
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Eye} label={t("stream.viewers")} value={twitch.phase === "connected" ? (stats.viewers ?? 0).toLocaleString() : "—"} />
              <Stat icon={Clock3} label={t("dashboard.streamDuration")} value={streamDuration(stats.startedAt)} />
            </div>
          </section>
          <section className="p-2">
            <div className="mb-1.5 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-muted"><MonitorPlay size={12} className="text-accent" />OBS</div><Badge tone={obs.phase === "connected" ? "green" : obs.phase === "reconnecting" || obs.phase === "connecting" ? "amber" : "neutral"}>{t(`connectionPhases.${obs.phase}`)}</Badge></div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat icon={Gauge} label={t("obs.bitrate")} value={snapshot?.streamBitrate != null ? `${snapshot.streamBitrate.toLocaleString()} kbit/s` : "—"} />
              <Stat icon={Cpu} label={t("obs.page.performance")} value={performance} />
              <Stat icon={Activity} label={t("obs.page.droppedFrames")} value={snapshot?.streamDropped?.toLocaleString() ?? "—"} />
              <Stat icon={Clapperboard} label={t("obs.scene")} value={snapshot?.scene ?? "—"} />
            </div>
          </section>
        </Card>
      </div>
    </>
  );
}
