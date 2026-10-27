import { useState } from "react";
import { Card, LoadingIndicator, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { saveSetting } from "../services/native";
import { money } from "../lib/utils";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";
function GoalRow({
  label,
  value,
  target,
  onTarget,
  display,
  loading,
}: {
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
  return (
    <div className="border-b border-line py-5 last:border-0">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="mt-1 text-xs text-muted">
            {loading ? (
              <LoadingIndicator className="h-3 w-32" />
            ) : value == null
              ? t("goals.unavailable")
              : `${display?.(value) ?? value.toLocaleString(i18n.language)} / ${target ? (display?.(target) ?? target.toLocaleString(i18n.language)) : t("goals.noTarget")}`}
          </div>
        </div>
        <input
          aria-label={t("goals.targetLabel", { label })}
          type="number"
          min="1"
          className="input w-32"
          placeholder={t("goals.target")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onTarget(draft ? Number(draft) : undefined)}
        />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
        {loading ? (
          <LoadingIndicator className="h-full w-2/5" />
        ) : (
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
}
export function Goals() {
  const { t } = useTranslation();
  const { stats, statsLoading, settings, setSettings } = useAppStore();
  const update = async (
    key: "followers" | "subscribers" | "donations",
    value?: number,
  ) => {
    const goals = { ...settings.goals, [key]: value };
    setSettings({ goals });
    await saveSetting("goals", goals);
  };
  return (
    <>
      <PageHeader icon={Target} title={t("goals.title")} />
      <Card className="px-5">
        <GoalRow
          label={t("goals.followers")}
          value={stats.followers}
          loading={statsLoading}
          target={settings.goals.followers}
          onTarget={(v) => update("followers", v)}
        />
        <GoalRow
          label={t("goals.subscribers")}
          value={stats.subscribers}
          loading={statsLoading}
          target={settings.goals.subscribers}
          onTarget={(v) => update("subscribers", v)}
        />
        <GoalRow
          label={t("goals.donations")}
          value={stats.donations}
          target={settings.goals.donations}
          onTarget={(v) => update("donations", v)}
          display={(v) => money(v, stats.donationCurrency)}
        />
      </Card>
    </>
  );
}
