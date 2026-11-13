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
import { Button, Card, EmptyState, PageHeader } from "../components/ui";
import { useAppStore } from "../stores/app-store";
import { format, subDays } from "date-fns";
import { useTranslation } from "react-i18next";
import { de, enUS, es, fr, ptBR } from "date-fns/locale";
export function Statistics() {
  const { t, i18n } = useTranslation();
  const dateLocale = { de, en: enUS, es, fr, "pt-BR": ptBR }[i18n.language] ?? enUS;
  const { events, setPage, twitch, streamElements, tipeeStream } =
    useAppStore();
  const connected = [twitch, streamElements, tipeeStream].some(
    (service) => service.phase === "connected",
  );
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
      <PageHeader
        icon={BarChart3}
        title={t("statistics.title")}
        description={t("pageDescriptions.statistics")}
      />
      {!events.length ? (
        <Card>
          <EmptyState
            icon={<BarChart3 size={24} />}
            title={t(connected ? "statistics.emptyConnected" : "statistics.empty")}
            body={t(connected ? "statistics.emptyConnectedDetail" : "statistics.emptyDetail")}
            action={!connected ? (
              <Button variant="primary" onClick={() => setPage("connections")}>
                {t("chat.openConnections")}
              </Button>
            ) : undefined}
          />
        </Card>
      ) : (
        <>
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
          <h2 className="text-xs font-semibold text-zinc-200">{t("statistics.activityOverTime")}</h2>
          <span className="text-[11px] text-muted">{t("statistics.lastDays", { count: 14 })}</span>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="var(--color-chart-grid)" vertical={false} />
              <XAxis
                dataKey="day"
                stroke="var(--color-muted)"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <YAxis
                allowDecimals={false}
                stroke="var(--color-muted)"
                tickLine={false}
                axisLine={false}
                fontSize={11}
              />
              <Tooltip
                cursor={{ fill: "var(--color-hover)" }}
                contentStyle={{
                  background: "var(--color-raised)",
                  border: "1px solid var(--color-rule-strong)",
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
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="metric-card">
          <div className="studio-label">{t("statistics.totalEvents")}</div>
          <div className="metric-value mt-1.5">
            {events.length.toLocaleString(i18n.language)}
          </div>
        </Card>
        <Card className="metric-card">
          <div className="studio-label">{t("statistics.eventTypes")}</div>
          <div className="metric-value mt-1.5">{types.length}</div>
        </Card>
        <Card className="metric-card">
          <div className="studio-label">{t("statistics.mostCommon")}</div>
          <div className="metric-value mt-1.5 text-lg capitalize">
            {types[0] ? t(`events.${types[0][0]}`) : "—"}
          </div>
        </Card>
      </div>
      {types.length > 0 && (
        <Card className="mt-3 p-4">
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-xs font-semibold text-ink-strong">{t("statistics.eventTypes")}</h2>
            <span className="studio-mono text-[11px] text-muted">{events.length.toLocaleString(i18n.language)}</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {types.map(([eventType, count]) => {
              const ratio = events.length > 0 ? Math.max(4, Math.round((count / events.length) * 100)) : 0;
              return (
                <div key={eventType} className="rounded-lg border border-rule bg-well px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium capitalize text-ink">{t(`events.${eventType}`)}</span>
                    <span className="shrink-0 studio-mono text-[11px] text-muted">
                      {count.toLocaleString(i18n.language)} · {Math.round((count / Math.max(1, events.length)) * 100)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${ratio}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
        </>
      )}
    </>
  );
}
