import { Button, Card, LoadingIndicator, PageHeader, Toggle } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { money } from "../lib/utils";
import { useTranslation } from "react-i18next";
import { Gem, Gift, Link2, RadioTower, Star, Target, Users, Wallet, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { GoalAutomation, GoalMetric } from "../types";
function GoalCard({
  icon: Icon,
  label,
  value,
  target,
  onTarget,
  display,
  loading,
  automation,
  onAutomation,
  money,
}: {
  icon: LucideIcon;
  label: string;
  value?: number;
  target?: number;
  onTarget: (v?: number) => void;
  display?: (n: number) => string;
  loading?: boolean;
  automation?: GoalAutomation;
  onAutomation: (value: GoalAutomation) => void;
  money?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const percent =
    value != null && target ? Math.min(100, (value / target) * 100) : 0;
  const formattedValue =
    value == null
      ? undefined
      : (display?.(value) ?? value.toLocaleString(i18n.language));
  const formattedTarget = target
    ? (display?.(target) ?? target.toLocaleString(i18n.language))
    : undefined;
  // Mirrors the automation in the runtime so the next target is visible before
  // the current one is reached.
  const increasePercent = Math.min(
    100,
    Math.max(5, automation?.increasePercent ?? 20),
  );
  const nextTarget =
    target == null
      ? undefined
      : (() => {
          const base = Math.max(target, value ?? 0);
          const raised = base * (1 + increasePercent / 100);
          return money
            ? Math.max(target + 0.01, Math.ceil(raised * 100) / 100)
            : Math.max(target + 1, Math.ceil(raised));
        })();
  const formattedNext =
    nextTarget == null
      ? undefined
      : (display?.(nextTarget) ?? nextTarget.toLocaleString(i18n.language));
  const saveDraft = (draft: string) => {
    const parsed = Number(draft);
    onTarget(draft && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  };
  const savePercent = (input: HTMLInputElement) => {
    const parsed = Number(input.value);
    const increasePercent = Number.isFinite(parsed)
      ? Math.min(100, Math.max(5, Math.round(parsed / 5) * 5))
      : 20;
    input.value = String(increasePercent);
    onAutomation({ enabled: automation?.enabled ?? false, increasePercent });
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

      <label className="block pt-4">
        <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-widest text-zinc-600">
          {t("goals.target")}
        </span>
        <input
          aria-label={t("goals.targetLabel", { label })}
          type="number"
          min="1"
          className="input"
          placeholder="—"
          key={target ?? "empty"}
          defaultValue={target?.toString() ?? ""}
          onBlur={(event) => saveDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </label>
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-zinc-300">{t("goals.autoTarget")}</div>
          </div>
          <Toggle
            value={automation?.enabled ?? false}
            onChange={(enabled) =>
              onAutomation({
                enabled,
                increasePercent: automation?.increasePercent ?? 20,
              })
            }
            label={t("goals.autoTargetLabel", { label })}
          />
        </div>
        {automation?.enabled && (
          <label className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              {t("goals.increaseBy")}
            </span>
            <span className="relative w-24">
              <input
                type="number"
                min="5"
                max="100"
                step="5"
                key={automation?.increasePercent ?? 20}
                defaultValue={automation?.increasePercent ?? 20}
                aria-label={t("goals.increaseLabel", { label })}
                onBlur={(event) => savePercent(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="input pr-7 text-right tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-600">%</span>
            </span>
          </label>
        )}
        {automation?.enabled && formattedNext && (
          <p className="mt-2 text-right text-[10px] tabular-nums text-zinc-500">
            {t("goals.nextTarget", { value: formattedNext })}
          </p>
        )}
      </div>
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
  const updateAutomation = async (
    key: GoalMetric,
    value: GoalAutomation,
  ) => {
    const goalAutomation = { ...settings.goalAutomation, [key]: value };
    setSettings({ goalAutomation });
    try {
      await saveSetting("goalAutomation", goalAutomation);
    } catch {
      setSettings({ goalAutomation: settings.goalAutomation });
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
          automation={settings.goalAutomation.followers}
          onAutomation={(value) => updateAutomation("followers", value)}
        />
        <GoalCard
          icon={Star}
          label={t("goals.subscribers")}
          value={stats.subscribers}
          loading={statsLoading}
          target={settings.goals.subscribers}
          onTarget={(v) => update("subscribers", v)}
          automation={settings.goalAutomation.subscribers}
          onAutomation={(value) => updateAutomation("subscribers", value)}
        />
        <GoalCard
          icon={Wallet}
          label={t("goals.donations")}
          value={stats.donations}
          target={settings.goals.donations}
          onTarget={(v) => update("donations", v)}
          display={(v) => money(v, stats.donationCurrency)}
          money
          automation={settings.goalAutomation.donations}
          onAutomation={(value) => updateAutomation("donations", value)}
        />
        <GoalCard
          icon={Gem}
          label={t("goals.bits")}
          value={stats.bits}
          target={settings.goals.bits}
          onTarget={(v) => update("bits", v)}
          automation={settings.goalAutomation.bits}
          onAutomation={(value) => updateAutomation("bits", value)}
        />
        <GoalCard
          icon={RadioTower}
          label={t("goals.raids")}
          value={raids}
          target={settings.goals.raids}
          onTarget={(v) => update("raids", v)}
          automation={settings.goalAutomation.raids}
          onAutomation={(value) => updateAutomation("raids", value)}
        />
        <GoalCard
          icon={Gift}
          label={t("goals.giftSubscriptions")}
          value={giftSubscriptions}
          target={settings.goals.giftSubscriptions}
          onTarget={(v) => update("giftSubscriptions", v)}
          automation={settings.goalAutomation.giftSubscriptions}
          onAutomation={(value) => updateAutomation("giftSubscriptions", value)}
        />
      </div>
    </>
  );
}
