import {
  CheckCircle2,
  Clock3,
  Crown,
  KeyRound,
  LifeBuoy,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card } from "../ui";
import { parseRateLimitWaitSeconds } from "../../lib/cloud-sync-limiter";
import { errorMessage } from "../../lib/utils";
import { useRuntime } from "../../services/runtime-context";
import { useAppStore } from "../../stores/app-store";

function mapSupportError(raw: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const lower = raw.trim().toLowerCase();
  if (lower.includes("message_too_short") || lower.includes("missing_message")) {
    return t("settings.support.errors.messageTooShort");
  }
  if (lower.includes("no_active_license")) {
    return t("settings.support.errors.noActiveLicense");
  }
  if (lower.includes("key_reset_limit_reached")) {
    return t("settings.support.errors.resetLimitReached");
  }
  if (lower.includes("ticket_already_pending")) {
    return t("settings.support.errors.alreadyPending");
  }
  const wait = parseRateLimitWaitSeconds(lower);
  if (wait) {
    return t("settings.support.errors.rateLimited", { seconds: wait });
  }
  return raw || t("settings.support.loadError");
}

export function SupportSection() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const twitch = useAppStore((s) => s.twitch);
  const entitlements = useAppStore((s) => s.entitlements);
  const supportTicket = useAppStore((s) => s.supportTicket);
  const setPage = useAppStore((s) => s.setPage);

  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  const twitchConnected = twitch.phase === "connected" && Boolean(twitch.userId);
  const latest = supportTicket?.latestTicket ?? undefined;
  const hasPending = latest?.status === "pending";

  useEffect(() => {
    if (!twitchConnected) return;
    void runtime.refreshSupportTicket(false);
  }, [twitchConnected, twitch.userId, runtime]);

  const handleRefresh = async () => {
    if (refreshing || !twitchConnected) return;
    setRefreshing(true);
    try {
      await runtime.refreshSupportTicket(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !twitchConnected) return;
    setSubmitError(undefined);
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setSubmitError(t("settings.support.errors.messageTooShort"));
      return;
    }
    setSubmitting(true);
    try {
      await runtime.submitKeyResetTicket(trimmed);
      setMessage("");
    } catch (err) {
      setSubmitError(mapSupportError(errorMessage(err), t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section id="support" className="scroll-mt-16">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        <LifeBuoy size={14} aria-hidden="true" />
        <span>{t("settings.support.sectionTitle")}</span>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound size={15} className="text-accent" aria-hidden="true" />
              <span className="text-sm font-semibold">{t("settings.support.title")}</span>
              {supportTicket?.hasActiveLicense ? (
                <Badge tone={supportTicket.resetsRemaining > 0 ? "green" : "amber"}>
                  {t("settings.support.resetsCounter", {
                    used: supportTicket.resetsUsed,
                    max: supportTicket.maxResets,
                  })}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted">{t("settings.support.description")}</p>
          </div>

          {twitchConnected && (
            <Button
              disabled={refreshing || supportTicket?.loading}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw
                size={13}
                className={refreshing || supportTicket?.loading ? "animate-spin" : ""}
              />
              {t("settings.support.refresh")}
            </Button>
          )}
        </div>

        {!twitchConnected ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-black/20 p-4 text-xs">
            <div className="text-muted">{t("settings.support.connectTwitchHint")}</div>
            <Button variant="primary" onClick={() => setPage("connections")}>
              {t("chat.openConnections")}
            </Button>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {latest && (
              <div
                className={`rounded-xl border p-4 text-xs ${
                  latest.status === "approved"
                    ? "border-emerald-500/30 bg-emerald-500/8"
                    : latest.status === "rejected"
                      ? "border-red-500/30 bg-red-500/8"
                      : "border-amber-500/30 bg-amber-500/8"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    {latest.status === "approved" ? (
                      <CheckCircle2 size={15} className="text-emerald-300" />
                    ) : latest.status === "rejected" ? (
                      <XCircle size={15} className="text-red-300" />
                    ) : (
                      <Clock3 size={15} className="text-amber-300" />
                    )}
                    <span>
                      {t("settings.support.ticketHeader", {
                        id: latest.id,
                        key: latest.licenseMasked,
                      })}
                    </span>
                  </div>
                  <Badge
                    tone={
                      latest.status === "approved"
                        ? "green"
                        : latest.status === "rejected"
                          ? "red"
                          : "amber"
                    }
                  >
                    {t(`settings.support.status.${latest.status}`)}
                  </Badge>
                </div>

                <div className="mt-2.5 space-y-2 text-zinc-300">
                  <div>
                    <span className="text-muted">{t("settings.support.yourReason")}: </span>
                    <span>{latest.userMessage}</span>
                  </div>
                  {latest.adminNote && (
                    <div className="rounded-lg border border-line/70 bg-black/25 px-3 py-2 text-zinc-200">
                      <div className="mb-0.5 text-[11px] font-medium text-muted">
                        {t("settings.support.adminReply")}
                      </div>
                      <div>{latest.adminNote}</div>
                    </div>
                  )}
                  <div className="text-[11px] text-muted">
                    {latest.status === "pending"
                      ? t("settings.support.pendingInfo")
                      : latest.status === "approved"
                        ? t("settings.support.approvedInfo")
                        : t("settings.support.rejectedInfo")}
                  </div>
                </div>
              </div>
            )}

            {hasPending ? null : !supportTicket?.hasActiveLicense && !entitlements.pro ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-line bg-black/20 p-3.5 text-xs text-muted">
                <Crown size={14} className="shrink-0 text-zinc-400" />
                <span>{t("settings.support.noActiveProInfo")}</span>
              </div>
            ) : supportTicket?.blockedReason === "key_reset_limit_reached" ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/8 p-3.5 text-xs text-amber-100">
                <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber-300" />
                <span>{t("settings.support.errors.resetLimitReached")}</span>
              </div>
            ) : supportTicket?.blockedReason === "support_cooldown" && supportTicket.cooldownUntil ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-line bg-black/20 p-3.5 text-xs text-muted">
                <Clock3 size={15} className="mt-0.5 shrink-0 text-zinc-400" />
                <span>
                  {t("settings.support.cooldownUntil", {
                    time: new Date(supportTicket.cooldownUntil).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}
                </span>
              </div>
            ) : (
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {t("settings.support.boundToAccount", {
                      account: twitch.account ?? "",
                      key:
                        supportTicket?.licenseMasked ??
                        entitlements.license?.maskedKey ??
                        "••••",
                    })}
                  </span>
                  <span>{message.trim().length}/500</span>
                </div>

                <textarea
                  className="input min-h-24 w-full resize-y py-2.5 text-xs leading-relaxed"
                  maxLength={500}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    if (submitError) setSubmitError(undefined);
                  }}
                  placeholder={t("settings.support.reasonPlaceholder")}
                />

                {submitError && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {submitError}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-zinc-400">
                    {t("settings.support.oneTimeWarning")}
                  </span>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting || message.trim().length < 10}
                  >
                    <Send size={13} />
                    {submitting ? t("settings.support.submitting") : t("settings.support.submitButton")}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
