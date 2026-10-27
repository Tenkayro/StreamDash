import { useState } from "react";
import { Button, Card, LoadingIndicator, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { money } from "../lib/utils";
import { useTranslation } from "react-i18next";
import { Gem, Gift, Link2, RadioTower, Star, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { GoalMetric } from "../types";
function GoalCard({
  icon: Icon,
  label,
  value,
  target,
  onTarget,
  display,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value?: number;
  target?: number;
  onTarget: (v?: number) => void;
  display?: (n: number) => string;
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const percent =
    value != null && target ? Math.min(100, (value / target) * 100) : 0;
  const [draft, setDraft] = useState(target?.toString() ?? "");
  const formattedValue =
    value == null
      ? undefined
      : (display?.(value) ?? value.toLocaleString(i18n.language));
  const formattedTarget = target
    ? (display?.(target) ?? target.toLocaleString(i18n.language))
    : undefined;
  const saveDraft = () => {
    const parsed = Number(draft);
    onTarget(draft && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  };
  return (
    <Card className="flex min-h-52 flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Icon size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{label}</div>
            <div className="mt-0.5 text-[10px] text-muted">
              {target ? t("goals.targetValue", { value: formattedTarget }) : t("goals.noTarget")}
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-[10px] font-semibold tabular-nums text-zinc-400">
          {target ? `${Math.round(percent)}%` : "—"}
        </span>
      </div>

      <div className="mt-5 min-h-8 text-2xl font-semibold tracking-[-.03em]">
        {loading ? (
          <LoadingIndicator className="h-7 w-20" />
        ) : formattedValue == null ? (
          <span className="text-sm font-normal tracking-normal text-muted">
            {t("goals.unavailable")}
          </span>
        ) : (
          <span className="tabular-nums">{formattedValue}</span>
        )}
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${loading ? 0 : percent}%` }}
        />
      </div>

      <label className="mt-auto block pt-4">
        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-zinc-600">
          {t("goals.target")}
        </span>
        <input
          aria-label={t("goals.targetLabel", { label })}
          type="number"
          min="1"
          className="input"
          placeholder="—"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
    </Card>
  );
}
export function Goals() {
  const { t } = useTranslation();
  const { stats, statsLoading, settings, setSettings, twitch, setPage, events } = useAppStore();
  const raids = events.filter((event) => event.eventType === "raid").length;
  const giftSubscriptions = events.reduce(
    (total, event) =>
      total +
      (event.eventType === "community_gift"
        ? (event.giftCount ?? 1)
        : event.eventType === "gift_subscription"
          ? 1
          : 0),
    0,
  );
  const update = async (
    key: GoalMetric,
    value?: number,
  ) => {
    const goals = { ...settings.goals, [key]: value };
    setSettings({ goals });
    try {
      await saveSetting("goals", goals);
    } catch {
      setSettings({ goals: settings.goals });
      toast.error(t("goals.saveError"));
    }
  };
  return (
    <>
      <PageHeader
        icon={Target}
        title={t("goals.title")}
        description={t("pageDescriptions.goals")}
        actions={
          twitch.phase !== "connected" ? (
            <Button onClick={() => setPage("connections")}>
              <Link2 size={14} />
              {t("chat.openConnections")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <GoalCard
          icon={Users}
          label={t("goals.followers")}
          value={stats.followers}
          loading={statsLoading}
          target={settings.goals.followers}
          onTarget={(v) => update("followers", v)}
        />
        <GoalCard
          icon={Star}
          label={t("goals.subscribers")}
          value={stats.subscribers}
          loading={statsLoading}
          target={settings.goals.subscribers}
          onTarget={(v) => update("subscribers", v)}
        />
        <GoalCard
          icon={Wallet}
          label={t("goals.donations")}
          value={stats.donations}
          target={settings.goals.donations}
          onTarget={(v) => update("donations", v)}
          display={(v) => money(v, stats.donationCurrency)}
        />
        <GoalCard
          icon={Gem}
          label={t("goals.bits")}
          value={stats.bits}
          target={settings.goals.bits}
          onTarget={(v) => update("bits", v)}
        />
        <GoalCard
          icon={RadioTower}
          label={t("goals.raids")}
          value={raids}
          target={settings.goals.raids}
          onTarget={(v) => update("raids", v)}
        />
        <GoalCard
          icon={Gift}
          label={t("goals.giftSubscriptions")}
          value={giftSubscriptions}
          target={settings.goals.giftSubscriptions}
          onTarget={(v) => update("giftSubscriptions", v)}
        />
      </div>
    </>
  );
}
