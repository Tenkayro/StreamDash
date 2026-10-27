import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { format, subDays } from "date-fns";
import { useTranslation } from "react-i18next";
import { de, enUS, es, fr, ptBR } from "date-fns/locale";
export function Statistics() {
  const { t, i18n } = useTranslation();
  const dateLocale = { de, en: enUS, es, fr, "pt-BR": ptBR }[i18n.language] ?? enUS;
  const events = useAppStore((s) => s.events);
  const [today] = useState(() => new Date());
  const data = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const day = subDays(today, 13 - i);
        const key = format(day, "yyyy-MM-dd");
        const dayEvents = events.filter(
          (e) => e.timestamp.slice(0, 10) === key,
        );
        return {
          day: format(day, "MMM d", { locale: dateLocale }),
          events: dayEvents.length,
          donations: dayEvents.reduce((n, e) => n + (e.amount ?? 0), 0),
        };
      }),
    [dateLocale, events, today],
  );
  const types = useMemo(
    () =>
      Object.entries(
        events.reduce<Record<string, number>>(
          (a, e) => ({ ...a, [e.eventType]: (a[e.eventType] || 0) + 1 }),
          {},
        ),
      ).sort((a, b) => b[1] - a[1]),
    [events],
  );
  return (
    <>
      <PageHeader icon={BarChart3} title={t("statistics.title")} />
      <Card className="p-5">
        <div className="mb-5">
          <h2 className="text-sm font-semibold">{t("statistics.activityOverTime")}</h2>
          <p className="mt-1 text-xs text-muted">{t("statistics.lastDays", { count: 14 })}</p>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="#24262d" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="#666a75"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <YAxis
                allowDecimals={false}
                stroke="#666a75"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <Tooltip
                cursor={{ fill: "#ffffff08" }}
                contentStyle={{
                  background: "#17181e",
                  border: "1px solid #2b2d34",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="events"
                fill="var(--app-accent)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs text-muted">{t("statistics.totalEvents")}</div>
          <div className="mt-2 text-3xl font-semibold">
            {events.length.toLocaleString(i18n.language)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted">{t("statistics.eventTypes")}</div>
          <div className="mt-2 text-3xl font-semibold">{types.length}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted">{t("statistics.mostCommon")}</div>
          <div className="mt-2 text-xl font-semibold capitalize">
            {types[0] ? t(`events.${types[0][0]}`) : "—"}
          </div>
        </Card>
      </div>
    </>
  );
}
