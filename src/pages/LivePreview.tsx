import { TwitchPlayer } from "../components/TwitchPlayer";
import { Badge, PageHeader } from "../components/ui";
import { useTranslation } from "react-i18next";
import { Activity, Clapperboard, Clock3, Cpu, Eye, Gauge, MonitorPlay, Radio } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAppStore } from "../stores/app-store";
import { formatObsTime } from "../services/obs/format";

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-black/15 px-3 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-white/5 text-zinc-500"><Icon size={13} /></span>
      <div className="min-w-0"><div className="truncate text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{label}</div><div className="mt-0.5 truncate text-xs font-semibold tabular-nums text-zinc-200">{value}</div></div>
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
      <div className="overflow-hidden rounded-xl border border-line bg-black shadow-2xl shadow-black/20">
        <TwitchPlayer className="aspect-video h-auto w-full" />
        <div className="grid border-t border-line bg-panel lg:grid-cols-[minmax(260px,.7fr)_minmax(480px,1.3fr)]">
          <section className="border-b border-line p-3 lg:border-b-0 lg:border-r">
            <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><Radio size={12} className="text-[#9147ff]" />Twitch</div><Badge tone={stats.live ? "green" : twitch.phase === "connected" ? "neutral" : "amber"}>{stats.live ? t("stream.live") : twitch.phase === "connected" ? t("stream.offline") : t(`connectionPhases.${twitch.phase}`)}</Badge></div>
            <div className="grid grid-cols-2 gap-2">
              <Stat icon={Eye} label={t("stream.viewers")} value={twitch.phase === "connected" ? (stats.viewers ?? 0).toLocaleString() : "—"} />
              <Stat icon={Clock3} label={t("dashboard.streamDuration")} value={streamDuration(stats.startedAt)} />
            </div>
          </section>
          <section className="p-3">
            <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><MonitorPlay size={12} className="text-accent" />OBS</div><Badge tone={obs.phase === "connected" ? "green" : obs.phase === "reconnecting" || obs.phase === "connecting" ? "amber" : "neutral"}>{t(`connectionPhases.${obs.phase}`)}</Badge></div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat icon={Gauge} label={t("obs.bitrate")} value={snapshot?.streamBitrate != null ? `${snapshot.streamBitrate.toLocaleString()} kbit/s` : "—"} />
              <Stat icon={Cpu} label={t("obs.page.performance")} value={performance} />
              <Stat icon={Activity} label={t("obs.page.droppedFrames")} value={snapshot?.streamDropped?.toLocaleString() ?? "—"} />
              <Stat icon={Clapperboard} label={t("obs.scene")} value={snapshot?.scene ?? "—"} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
