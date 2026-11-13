import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cloud,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Copy,
  Crown,
  ExternalLink,
  HardDrive,
  Info,
  KeyRound,
  LifeBuoy,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card, Toggle } from "../ui";
import {
  formatCloudError,
  isCloudServerUnavailableError,
  mapProError,
  openProPurchasePage,
} from "../../lib/pro";
import { parseRateLimitWaitSeconds } from "../../lib/cloud-sync-limiter";
import { errorMessage } from "../../lib/utils";
import { useRuntime } from "../../services/runtime-context";
import { useAppStore } from "../../stores/app-store";
import { useNetworkStore } from "../../stores/network-store";

function mapSupportError(
  raw: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
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

export function ProCloudSection() {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const twitch = useAppStore((s) => s.twitch);
  const entitlements = useAppStore((s) => s.entitlements);
  const cloudSyncEnabled = useAppStore((s) => s.cloudSyncEnabled);
  const cloudSyncCheckpoints = useAppStore((s) => s.cloudSyncCheckpoints);
  const cloudSync = useAppStore((s) => s.cloudSync);
  const supportTicket = useAppStore((s) => s.supportTicket);
  const storageTicket = useAppStore((s) => s.storageTicket);
  const setPage = useAppStore((s) => s.setPage);

  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string>();

  const [syncBusy, setSyncBusy] = useState(false);
  const [deleteCloudOpen, setDeleteCloudOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [resetExpanded, setResetExpanded] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetRefreshing, setResetRefreshing] = useState(false);
  const [resetError, setResetError] = useState<string>();
  const [dismissedTickets, setDismissedTickets] = useState<Record<string, string>>({});

  const [storageExpanded, setStorageExpanded] = useState(false);
  const [storageRequestMb, setStorageRequestMb] = useState<number>(50);
  const [storageMessage, setStorageMessage] = useState("");
  const [storageSubmitting, setStorageSubmitting] = useState(false);
  const [storageRefreshing, setStorageRefreshing] = useState(false);
  const [storageError, setStorageError] = useState<string>();

  const twitchConnected = twitch.phase === "connected" && Boolean(twitch.userId);
  const storageInfo = storageTicket?.storage ?? cloudSync.storageInfo;
  const latestStorageTicket = storageTicket?.latestTicket ?? undefined;
  const hasPendingStorageTicket = latestStorageTicket?.status === "pending";

  useEffect(() => {
    if (twitchConnected && entitlements.pro && !storageTicket) {
      void runtime.refreshStorageTicket(false);
    }
  }, [twitchConnected, entitlements.pro, storageTicket, runtime]);

  const handleStorageRefresh = async () => {
    setStorageRefreshing(true);
    setStorageError(undefined);
    try {
      await runtime.refreshStorageTicket(true);
    } finally {
      setStorageRefreshing(false);
    }
  };

  const handleStorageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = storageMessage.trim();
    if (trimmed.length < 10) {
      setStorageError(t("settings.support.errors.messageTooShort"));
      return;
    }
    setStorageSubmitting(true);
    setStorageError(undefined);
    try {
      await runtime.submitStorageRequestTicket(storageRequestMb, trimmed);
      setStorageMessage("");
    } catch (err) {
      setStorageError(mapSupportError(errorMessage(err), t));
    } finally {
      setStorageSubmitting(false);
    }
  };
  const latest = supportTicket?.latestTicket ?? undefined;
  const hasPending = latest?.status === "pending";
  const ticketFingerprint = latest
    ? `${latest.id}:${latest.status}:${latest.decidedAt ?? latest.updatedAt}`
    : undefined;
  const dismissedTicketKey = (() => {
    if (!twitch.userId) return undefined;
    if (dismissedTickets[twitch.userId] !== undefined) {
      return dismissedTickets[twitch.userId];
    }
    try {
      return localStorage.getItem(`streamdash:dismissed-support-ticket:${twitch.userId}`) ?? undefined;
    } catch {
      return undefined;
    }
  })();
  const isStaleApproved = latest?.status === "approved" && entitlements.pro;
  const isTicketDismissed = Boolean(
    ticketFingerprint && dismissedTicketKey === ticketFingerprint,
  );
  const showTicketCard = Boolean(
    latest && !isStaleApproved && (hasPending || !isTicketDismissed),
  );
  const showResetPanel = resetExpanded || showTicketCard;

  const currentCheckpoint = twitch.userId ? cloudSyncCheckpoints[twitch.userId] : undefined;
  const activeCloudMeta = cloudSync.remoteMeta;
  const cloudBytes = activeCloudMeta?.rawBytes ?? currentCheckpoint?.rawBytes;
  const cloudTimestamp =
    cloudSync.lastSyncedAt ?? currentCheckpoint?.syncedAt ?? activeCloudMeta?.serverUpdatedAt;
  const hasRemoteBackup = Boolean(
    activeCloudMeta?.exists || currentCheckpoint || cloudSync.phase === "synced",
  );
  const cooldownSeconds =
    cloudSync.cooldownUntil && cloudSync.cooldownUntil > nowMs
      ? Math.max(1, Math.ceil((cloudSync.cooldownUntil - nowMs) / 1000))
      : 0;
  const networkOnline = useNetworkStore((state) => state.online);
  const serverOffline =
    !networkOnline ||
    Boolean(
      isCloudServerUnavailableError(entitlements.error) ||
        isCloudServerUnavailableError(cloudSync.error) ||
        isCloudServerUnavailableError(supportTicket?.error) ||
        isCloudServerUnavailableError(activateError),
    );
  const syncButtonsDisabled =
    serverOffline || syncBusy || cloudSync.phase === "syncing" || cooldownSeconds > 0;

  const handleDismissTicket = () => {
    if (!ticketFingerprint || hasPending || !twitch.userId) return;
    const uid = twitch.userId;
    setDismissedTickets((prev) => ({ ...prev, [uid]: ticketFingerprint }));
    setResetExpanded(false);
    try {
      localStorage.setItem(`streamdash:dismissed-support-ticket:${uid}`, ticketFingerprint);
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    if (!twitchConnected) return;
    void runtime.refreshProEntitlements().catch(() => undefined);
    void runtime.refreshSupportTicket(false);
  }, [twitchConnected, twitch.userId, runtime]);

  useEffect(() => {
    const onOpenSupport = () => setResetExpanded(true);
    window.addEventListener("streamdash:open-support", onOpenSupport);
    return () => window.removeEventListener("streamdash:open-support", onOpenSupport);
  }, []);

  useEffect(() => {
    const until = cloudSync.cooldownUntil;
    if (!until || until <= Date.now()) return;
    const kick = window.setTimeout(() => setNowMs(Date.now()), 0);
    const timer = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= until) {
        window.clearInterval(timer);
      }
    }, 500);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [cloudSync.cooldownUntil]);

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (activating) return;
    const trimmed = licenseKey.trim();
    if (!trimmed) {
      setActivateError(t("pro.errors.invalidKey"));
      return;
    }
    setActivating(true);
    setActivateError(undefined);
    try {
      await runtime.activateProLicense(trimmed);
      setLicenseKey("");
    } catch (err) {
      setActivateError(mapProError(errorMessage(err), t));
    } finally {
      setActivating(false);
    }
  };

  const handleResetRefresh = async () => {
    if (resetRefreshing || !twitchConnected) return;
    setResetRefreshing(true);
    try {
      await runtime.refreshSupportTicket(true);
    } finally {
      setResetRefreshing(false);
    }
  };

  const handleResetSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resetSubmitting || !twitchConnected) return;
    setResetError(undefined);
    const trimmed = resetMessage.trim();
    if (trimmed.length < 10) {
      setResetError(t("settings.support.errors.messageTooShort"));
      return;
    }
    setResetSubmitting(true);
    try {
      await runtime.submitKeyResetTicket(trimmed);
      setResetMessage("");
    } catch (err) {
      setResetError(mapSupportError(errorMessage(err), t));
    } finally {
      setResetSubmitting(false);
    }
  };

  const activeKeyId = entitlements.license?.keyId ?? supportTicket?.keyId;
  const activeMasked = entitlements.license?.maskedKey ?? supportTicket?.licenseMasked;

  return (
    <section id="pro" className="scroll-mt-16">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <Crown size={12} aria-hidden="true" />
          <span>{t("settings.proCloud")}</span>
        </h2>
        {entitlements.pro ? (
          <Badge tone="green">PRO · @{twitch.account ?? ""}</Badge>
        ) : (
          <Badge tone="neutral">{t("pro.lockedBadge")}</Badge>
        )}
      </div>

      <Card className="overflow-hidden">
        {serverOffline && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/25 bg-amber-500/10 px-5 py-3 text-xs text-amber-100">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <CloudOff size={15} className="shrink-0 text-amber-300" />
              <div className="min-w-0">
                <div className="font-semibold text-amber-200">{t("pro.offlineTitle")}</div>
                <div className="text-[11px] text-amber-200/80">{t("pro.offlineDetail")}</div>
              </div>
            </div>
            <Button
              type="button"
              disabled={entitlements.loading || syncBusy}
              onClick={() => {
                setSyncBusy(true);
                setActivateError(undefined);
                void runtime
                  .refreshProEntitlements()
                  .then((ent) => {
                    if (ent.pro) {
                      return runtime.syncCloudNow("smart").catch(() => undefined);
                    }
                    return undefined;
                  })
                  .catch(() => undefined)
                  .finally(() => setSyncBusy(false));
              }}
            >
              <RefreshCw
                size={13}
                className={entitlements.loading || syncBusy ? "animate-spin" : ""}
              />
              {t("pro.retryConnection")}
            </Button>
          </div>
        )}
        {/* Step / License Block */}
        <div
          data-search-label={`${t("settings.proCloud")} ${t("pro.title")}`}
          className="border-b border-line px-5 py-4"
        >
          {!twitchConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-twitch-border bg-twitch-soft p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-semibold text-ink-strong">{t("pro.subtitle")}</div>
                <p className="text-xs text-ink">{t("pro.connectStepHint")}</p>
              </div>
              <Button variant="primary" onClick={() => setPage("connections")}>
                {t("chat.openConnections")}
              </Button>
            </div>
          ) : entitlements.pro ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-strong">
                    {t("pro.activeForAccount", { account: twitch.account ?? "" })}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {t("pro.licenseSummary", {
                      key: activeMasked ?? "••••",
                      date: entitlements.license?.activatedAt
                        ? new Date(entitlements.license.activatedAt).toLocaleDateString()
                        : "—",
                    })}
                  </div>
                </div>
              </div>

              {activeKeyId && (
                <div className="flex items-center gap-2 rounded-lg border border-rule bg-well px-2.5 py-1 text-xs">
                  <span className="text-muted">{t("pro.keyIdLabel")}:</span>
                  <code className="font-mono font-semibold text-ink-strong">{activeKeyId}</code>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(activeKeyId).then(() => {
                        toast.success(t("pro.keyIdCopied"));
                      });
                    }}
                    className="grid size-6 place-items-center rounded text-muted transition hover:bg-raised hover:text-ink-strong"
                    title={t("pro.keyIdLabel")}
                    aria-label={t("pro.keyIdLabel")}
                  >
                    <Copy size={12} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/20 p-4">
                <div className="space-y-2.5">
                  <div className="text-sm font-semibold text-zinc-100">{t("pro.buyCardTitle")}</div>
                  <p className="text-xs text-muted">{t("pro.buyCardDetail")}</p>
                  <div className="space-y-1.5 pt-1 text-xs text-zinc-300">
                    <div className="flex items-center gap-2">
                      <Cloud size={13} className="shrink-0 text-accent" />
                      <span>{t("pro.perks.cloudSync")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={13} className="shrink-0 text-emerald-400" />
                      <span>{t("pro.perks.twitchBound", { account: twitch.account ?? "" })}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="shrink-0 text-twitch-ink" />
                      <span>{t("pro.perks.futureFeatures")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <HardDrive size={13} className="shrink-0 text-signal-2" />
                      <span>{t("pro.perks.storageQuota")}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void openProPurchasePage()}
                  >
                    <ExternalLink size={13} />
                    {t("pro.getProButton")}
                  </Button>
                </div>
              </div>

              <form
                onSubmit={(e) => void handleActivate(e)}
                className="flex flex-col justify-between gap-3 rounded-[10px] border border-rule bg-well p-4"
              >
                <div className="space-y-2">
                  <label
                    htmlFor="settings-pro-license-key"
                    className="studio-label block"
                  >
                    {t("pro.licenseKeyLabel")}
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <KeyRound
                        size={14}
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
                      />
                      <input
                        id="settings-pro-license-key"
                        className="input input-leading-icon studio-mono w-full text-xs"
                        placeholder={t("pro.licenseKeyPlaceholder")}
                        value={licenseKey}
                        onChange={(e) => {
                          setLicenseKey(e.target.value);
                          if (activateError) setActivateError(undefined);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={serverOffline || activating || !licenseKey.trim()}
                    >
                      {activating ? t("pro.activating") : t("pro.activateButton")}
                    </Button>
                  </div>
                  {activateError && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-200">
                      {activateError}
                    </div>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  {t("pro.permanentBindHint", { account: twitch.account ?? "" })}
                </p>
              </form>
            </div>
          )}
        </div>

        {/* Cloud Sync Block */}
        <div
          data-search-label={t("profiles.cloud.title")}
          className="border-b border-line px-5 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {!cloudSyncEnabled ? (
                <CloudOff size={16} className="shrink-0 text-muted" />
              ) : cloudSync.phase === "conflict" ? (
                <AlertTriangle size={16} className="shrink-0 text-amber-300" />
              ) : cloudSync.phase === "error" ? (
                <Cloud size={16} className="shrink-0 text-red-300" />
              ) : (
                <Cloud
                  size={16}
                  className={
                    cloudSyncEnabled && twitchConnected && entitlements.pro
                      ? "shrink-0 text-emerald-400"
                      : "shrink-0 text-muted"
                  }
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("profiles.cloud.title")}</span>
                  {!twitchConnected ? (
                    <Badge tone="neutral">{t("profiles.cloud.statusDisconnected")}</Badge>
                  ) : serverOffline ? (
                    <Badge tone="amber">{t("pro.offlineBadge")}</Badge>
                  ) : !entitlements.pro ? (
                    <Badge tone="neutral">{t("pro.lockedBadge")}</Badge>
                  ) : cloudSync.phase === "syncing" ? (
                    <Badge tone="amber">{t("profiles.cloud.statusSyncing")}</Badge>
                  ) : cloudSync.phase === "conflict" ? (
                    <Badge tone="amber">{t("profiles.cloud.statusConflict")}</Badge>
                  ) : cloudSync.phase === "error" ? (
                    <Badge tone="red">{t("profiles.cloud.statusError")}</Badge>
                  ) : cloudSync.phase === "pending" || cloudSync.hasLocalChanges ? (
                    <Badge tone="amber">{t("profiles.cloud.statusPending")}</Badge>
                  ) : !cloudSyncEnabled ? (
                    <Badge tone="neutral">{t("profiles.cloud.statusPaused")}</Badge>
                  ) : cloudSync.phase === "synced" || hasRemoteBackup ? (
                    <Badge tone="green">{t("profiles.cloud.statusSynced")}</Badge>
                  ) : (
                    <Badge tone="neutral">{t("profiles.cloud.statusReady")}</Badge>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span>
                    {!twitchConnected
                      ? t("profiles.cloud.connectPrompt")
                      : serverOffline
                        ? t("pro.offlineDetail")
                        : !entitlements.pro
                          ? t("pro.cloudGateHint", { account: twitch.account ?? "" })
                          : cloudSync.phase === "error" && cloudSync.error
                            ? formatCloudError(cloudSync.error, t)
                            : cloudTimestamp
                              ? t("profiles.cloud.metaSummary", {
                                  account: twitch.account ?? "",
                                  time: new Date(cloudTimestamp).toLocaleString([], {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  }),
                                  size: cloudBytes
                                    ? `${Math.max(1, Math.round(cloudBytes / 1024))} KB`
                                    : "—",
                                })
                              : t("profiles.cloud.connectedHint", {
                                  account: twitch.account ?? "",
                                })}
                  </span>
                  {twitchConnected && entitlements.pro && storageInfo && (() => {
                    const usedPct = Math.min(
                      100,
                      Math.round((storageInfo.usedBytes / Math.max(1, storageInfo.quotaBytes)) * 100),
                    );
                    return (
                    <span className="inline-flex items-center gap-1 text-subtle">
                      <span>·</span>
                      <span className="font-mono text-[11px]">
                        {t("profiles.cloud.storage.usagePercent", { percent: usedPct })}
                      </span>
                      <button
                        type="button"
                        disabled={storageRefreshing || storageTicket?.loading}
                        onClick={() => void handleStorageRefresh()}
                        title={t("settings.support.refresh")}
                        aria-label={t("settings.support.refresh")}
                        className="rounded p-0.5 text-subtle transition hover:bg-raised hover:text-ink disabled:opacity-40"
                      >
                        <RefreshCw
                          size={11}
                          className={storageRefreshing || storageTicket?.loading ? "animate-spin" : ""}
                        />
                      </button>
                    </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {twitchConnected && entitlements.pro && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={syncButtonsDisabled}
                  title={
                    cooldownSeconds > 0
                      ? t("profiles.cloud.cooldownHint", { seconds: cooldownSeconds })
                      : t("profiles.cloud.uploadHint")
                  }
                  onClick={() => {
                    setSyncBusy(true);
                    void runtime
                      .syncCloudNow("push")
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  <CloudUpload size={13} />
                  {t("profiles.cloud.upload")}
                  {cooldownSeconds >= 4 ? ` (${cooldownSeconds}s)` : ""}
                </Button>
                <Button
                  disabled={syncButtonsDisabled}
                  title={
                    cooldownSeconds > 0
                      ? t("profiles.cloud.cooldownHint", { seconds: cooldownSeconds })
                      : t("profiles.cloud.downloadHint")
                  }
                  onClick={() => {
                    setSyncBusy(true);
                    void runtime
                      .syncCloudNow("pull", { merge: false })
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  <CloudDownload size={13} />
                  {t("profiles.cloud.download")}
                </Button>
                {hasRemoteBackup && (
                  <Button
                    disabled={syncButtonsDisabled}
                    title={
                      cooldownSeconds > 0
                        ? t("profiles.cloud.cooldownHint", { seconds: cooldownSeconds })
                        : t("profiles.cloud.deleteAction")
                    }
                    aria-label={t("profiles.cloud.deleteAction")}
                    onClick={() => setDeleteCloudOpen(true)}
                    className="hover:border-red-500/30 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
                <div className="flex items-center gap-2 pl-1">
                  <span className="text-xs text-muted">{t("profiles.cloud.autoSyncShort")}</span>
                  <Toggle
                    label={t("profiles.cloud.autoSyncLabel")}
                    value={cloudSyncEnabled}
                    onChange={(value) => void runtime.setCloudSyncEnabled(value)}
                  />
                </div>
              </div>
            )}
          </div>

          {cloudSync.phase === "conflict" && cloudSync.conflict && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-amber-200">
                  {t("profiles.cloud.conflictTitle")}
                </div>
                <div className="mt-0.5 text-[11px] text-amber-200/80">
                  {t("profiles.cloud.conflictDetail", {
                    rev: cloudSync.conflict.remoteMeta.revision ?? 1,
                    time: cloudSync.conflict.remoteMeta.serverUpdatedAt
                      ? new Date(cloudSync.conflict.remoteMeta.serverUpdatedAt).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—",
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="primary"
                  disabled={syncBusy}
                  onClick={() => {
                    setSyncBusy(true);
                    void runtime
                      .syncCloudNow("pull", { merge: false })
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  <CloudDownload size={13} />
                  {t("profiles.cloud.useCloud")}
                </Button>
                <Button
                  disabled={syncBusy}
                  onClick={() => {
                    setSyncBusy(true);
                    void runtime
                      .syncCloudNow("pull", { merge: true })
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  {t("profiles.cloud.mergeCloud")}
                </Button>
                <Button
                  disabled={syncBusy}
                  onClick={() => {
                    setSyncBusy(true);
                    void runtime
                      .syncCloudNow("push", { force: true })
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  {t("profiles.cloud.keepLocal")}
                </Button>
              </div>
            </div>
          )}

          {twitchConnected && entitlements.pro && storageInfo && (() => {
            const nearLimit =
              storageInfo.usedBytes >= storageInfo.quotaBytes * 0.75 ||
              Boolean(cloudSync.historyError?.includes("storage_quota_exceeded"));
            const showStorageBanner =
              nearLimit ||
              storageExpanded ||
              hasPendingStorageTicket ||
              Boolean(latestStorageTicket) ||
              Boolean(cloudSync.historyError) ||
              (storageInfo.globalSoftThrottled && !storageInfo.customQuotaBytes);
            if (!showStorageBanner) return null;
            const showRequestAction = nearLimit || hasPendingStorageTicket || Boolean(latestStorageTicket);
            const usedPct = Math.min(
              100,
              Math.round((storageInfo.usedBytes / Math.max(1, storageInfo.quotaBytes)) * 100),
            );
            const pct = Math.min(
              100,
              Math.max(
                storageInfo.usedBytes > 0 ? 2 : 0,
                usedPct,
              ),
            );
            return (
              <div className="mt-3 rounded-lg border border-rule bg-well px-3 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-ink">
                    <HardDrive size={13} className="text-muted" />
                    <span className="font-medium">{t("profiles.cloud.storage.title")}</span>
                  </div>
                  <div className="h-1.5 min-w-22.5 flex-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className={`h-full w-full origin-left rounded-full transition-transform ${
                        storageInfo.usedBytes >= storageInfo.quotaBytes
                          ? "bg-red-400"
                          : nearLimit
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                      }`}
                      style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})` }}
                    />
                  </div>
                  <Badge
                    tone={
                      storageInfo.usedBytes >= storageInfo.quotaBytes
                        ? "red"
                        : nearLimit
                          ? "amber"
                          : "green"
                    }
                  >
                    {t("profiles.cloud.storage.usageBadge", {
                      percent: usedPct,
                      used: (storageInfo.usedBytes / (1024 * 1024)).toFixed(2),
                      quota: Math.round(storageInfo.quotaBytes / (1024 * 1024)),
                    })}
                  </Badge>
                  {storageInfo.globalSoftThrottled && !storageInfo.customQuotaBytes && (
                    <Badge tone="amber">{t("profiles.cloud.storage.throttledBadge")}</Badge>
                  )}
                  {hasPendingStorageTicket && (
                    <Badge tone="amber">{t("settings.support.status.pending")}</Badge>
                  )}
                  <button
                    type="button"
                    disabled={storageRefreshing || storageTicket?.loading}
                    onClick={() => void handleStorageRefresh()}
                    title={t("settings.support.refresh")}
                    aria-label={t("settings.support.refresh")}
                    className="rounded-md p-1 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40"
                  >
                    <RefreshCw
                      size={12}
                      className={storageRefreshing || storageTicket?.loading ? "animate-spin" : ""}
                    />
                  </button>
                  {showRequestAction && (
                    <Button
                      type="button"
                      onClick={() => setStorageExpanded((prev) => !prev)}
                    >
                      {storageExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {t("profiles.cloud.storage.requestButton")}
                    </Button>
                  )}
                </div>

                {cloudSync.historyError && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                    {(() => {
                      if (cloudSync.historyError.includes("storage_quota_exceeded")) {
                        return t("profiles.cloud.storage.quotaExceededToast");
                      }
                      if (cloudSync.historyError.includes("storage_pool_full")) {
                        return t("profiles.cloud.storage.poolFullToast");
                      }
                      const wait = parseRateLimitWaitSeconds(cloudSync.historyError);
                      if (wait) {
                        return t("settings.support.errors.rateLimited", { seconds: wait });
                      }
                      return cloudSync.historyError;
                    })()}
                  </div>
                )}

                {(storageExpanded || hasPendingStorageTicket) && (
                  <div className="mt-2.5 space-y-2.5 border-t border-line/70 pt-2.5">
                  {latestStorageTicket && (
                    <div
                      className={`rounded-lg border p-2.5 text-[11px] ${
                        latestStorageTicket.status === "approved"
                          ? "border-emerald-500/30 bg-emerald-500/8"
                          : latestStorageTicket.status === "rejected"
                            ? "border-red-500/30 bg-red-500/8"
                            : "border-amber-500/30 bg-amber-500/8"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                        <span>
                          {t("profiles.cloud.storage.ticketHeader", {
                            id: latestStorageTicket.id,
                            mb: latestStorageTicket.requestedMb,
                          })}
                        </span>
                        <Badge
                          tone={
                            latestStorageTicket.status === "approved"
                              ? "green"
                              : latestStorageTicket.status === "rejected"
                                ? "red"
                                : "amber"
                          }
                        >
                          {t(`settings.support.status.${latestStorageTicket.status}`)}
                        </Badge>
                      </div>
                      {latestStorageTicket.adminNote && (
                        <div className="mt-1 text-zinc-300">
                          {t("settings.support.adminNote")}: {latestStorageTicket.adminNote}
                        </div>
                      )}
                    </div>
                  )}

                  {storageTicket?.canSubmit && (
                    <form onSubmit={(e) => void handleStorageSubmit(e)} className="space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-300">
                          {t("profiles.cloud.storage.selectTargetLabel")}
                        </span>
                        {[25, 50, 100].map((addMb) => {
                          const currentMb = Math.round(storageInfo.quotaBytes / (1024 * 1024));
                          const targetMb = Math.min(500, currentMb + addMb);
                          const active = storageRequestMb === targetMb;
                          return (
                            <Button
                              key={addMb}
                              type="button"
                              variant={active ? "primary" : "default"}
                              onClick={() => setStorageRequestMb(targetMb)}
                            >
                              +{addMb} MB ({targetMb} MB)
                            </Button>
                          );
                        })}
                      </div>
                      <textarea
                        className="input min-h-17 w-full py-2 text-xs"
                        placeholder={t("profiles.cloud.storage.messagePlaceholder")}
                        value={storageMessage}
                        onChange={(e) => {
                          setStorageMessage(e.target.value);
                          if (storageError) setStorageError(undefined);
                        }}
                        maxLength={500}
                      />
                      {storageError && (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                          {storageError}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={storageSubmitting || storageMessage.trim().length < 10}
                        >
                          <Send size={12} />
                          {storageSubmitting
                            ? t("settings.support.submitting")
                            : t("profiles.cloud.storage.submitButton")}
                        </Button>
                      </div>
                    </form>
                  )}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-subtle">
            <Info size={12} className="shrink-0" />
            <span>{t("profiles.cloud.zeroSecretsHint")}</span>
          </div>
        </div>

        {/* Integrated Key Reset / Support Panel */}
        <div
          id="support"
          data-search-label={t("settings.support.title")}
          className="scroll-mt-20 px-5 py-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <LifeBuoy size={16} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{t("settings.support.title")}</span>
                  {showResetPanel && supportTicket?.hasActiveLicense ? (
                    <Badge tone={supportTicket.resetsRemaining > 0 ? "green" : "amber"}>
                      {t("settings.support.resetsCounter", {
                        used: supportTicket.resetsUsed,
                        max: supportTicket.maxResets,
                      })}
                    </Badge>
                  ) : null}
                  {hasPending && (
                    <Badge tone="amber">{t("settings.support.status.pending")}</Badge>
                  )}
                </div>
                {showResetPanel && (
                  <p className="mt-0.5 text-xs text-muted">{t("settings.support.description")}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {twitchConnected && showResetPanel && (
                <Button
                  disabled={resetRefreshing || supportTicket?.loading}
                  onClick={() => void handleResetRefresh()}
                >
                  <RefreshCw
                    size={13}
                    className={resetRefreshing || supportTicket?.loading ? "animate-spin" : ""}
                  />
                  {t("settings.support.refresh")}
                </Button>
              )}
              {!hasPending && (
                <Button
                  type="button"
                  onClick={() => {
                    if (showResetPanel) {
                      if (showTicketCard) {
                        handleDismissTicket();
                      } else {
                        setResetExpanded(false);
                      }
                    } else {
                      setResetExpanded(true);
                    }
                  }}
                >
                  {showResetPanel ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {showResetPanel
                    ? t("settings.support.hidePanel")
                    : t("settings.support.manageReset")}
                </Button>
              )}
            </div>
          </div>

          {showResetPanel && (
            <div className="mt-4 space-y-3 border-t border-line/70 pt-4">
              {!twitchConnected ? (
                <div className="text-xs text-muted">{t("settings.support.connectTwitchHint")}</div>
              ) : (
                <>
                  {showTicketCard && latest && (
                    <div
                      className={`rounded-xl border p-3.5 text-xs ${
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
                            <CheckCircle2 size={14} className="text-emerald-300" />
                          ) : latest.status === "rejected" ? (
                            <XCircle size={14} className="text-red-300" />
                          ) : (
                            <Clock3 size={14} className="text-amber-300" />
                          )}
                          <span>
                            {t("settings.support.ticketHeader", {
                              id: latest.id,
                              key: latest.licenseMasked,
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
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
                          {!hasPending && (
                            <button
                              type="button"
                              onClick={handleDismissTicket}
                              title={t("settings.support.dismiss")}
                              aria-label={t("settings.support.dismiss")}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                            >
                              <X size={12} />
                              {t("settings.support.dismiss")}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 space-y-1.5 text-zinc-300">
                        <div>
                          <span className="text-muted">{t("settings.support.yourReason")}: </span>
                          <span>{latest.userMessage}</span>
                        </div>
                        {latest.adminNote && (
                          <div className="rounded-lg border border-rule bg-well px-3 py-2 text-ink">
                            <div className="studio-label mb-0.5">
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
                              : supportTicket?.blockedReason === "support_cooldown" &&
                                  supportTicket.cooldownUntil
                                ? `${t("settings.support.rejectedInfo")} ${t("settings.support.cooldownFooter", {
                                    time: new Date(supportTicket.cooldownUntil).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }),
                                  })}`
                                : t("settings.support.rejectedInfo")}
                        </div>
                      </div>
                    </div>
                  )}

                  {!hasPending &&
                    !(showTicketCard && latest?.status === "approved") &&
                    (
                    !supportTicket?.hasActiveLicense && !entitlements.pro ? (
                      <div className="rounded-[10px] border border-rule bg-well p-3 text-xs text-muted">
                        {t("settings.support.noActiveProInfo")}
                      </div>
                    ) : supportTicket?.blockedReason === "key_reset_limit_reached" ? (
                      <div className="flex items-start gap-2.5 rounded-[10px] border border-amber-500/25 bg-amber-500/8 p-3 text-xs text-amber-100">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-300" />
                        <span>{t("settings.support.errors.resetLimitReached")}</span>
                      </div>
                    ) : supportTicket?.blockedReason === "support_cooldown" &&
                      supportTicket.cooldownUntil ? (
                      showTicketCard && latest?.status === "rejected" ? null : (
                        <div className="flex items-start gap-2.5 rounded-[10px] border border-rule bg-well p-3 text-xs text-muted">
                          <Clock3 size={14} className="mt-0.5 shrink-0 text-subtle" />
                          <span>
                            {t("settings.support.cooldownUntil", {
                              time: new Date(supportTicket.cooldownUntil).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            })}
                          </span>
                        </div>
                      )
                    ) : (
                      <form onSubmit={(e) => void handleResetSubmit(e)} className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                          <span>
                            {t("settings.support.boundToAccount", {
                              account: twitch.account ?? "",
                              key: activeKeyId
                                ? `${activeKeyId} · ${activeMasked ?? "••••"}`
                                : (activeMasked ?? "••••"),
                            })}
                          </span>
                          <span>{resetMessage.trim().length}/500</span>
                        </div>

                        <textarea
                          className="input min-h-20 w-full resize-y py-2 text-xs leading-relaxed"
                          maxLength={500}
                          value={resetMessage}
                          onChange={(e) => {
                            setResetMessage(e.target.value);
                            if (resetError) setResetError(undefined);
                          }}
                          placeholder={t("settings.support.reasonPlaceholder")}
                        />

                        {resetError && (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                            {resetError}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="text-[11px] text-zinc-400">
                            {t("settings.support.cloudRetentionHint")}
                          </span>
                          <Button
                            type="submit"
                            variant="primary"
                            disabled={resetSubmitting || resetMessage.trim().length < 10}
                          >
                            <Send size={13} />
                            {resetSubmitting
                              ? t("settings.support.submitting")
                              : t("settings.support.submitButton")}
                          </Button>
                        </div>
                      </form>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      {deleteCloudOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xs"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteCloudOpen(false);
          }}
        >
          <Card className="w-full max-w-md overflow-hidden rounded-[14px] border-rule-strong bg-panel p-0 shadow-2xl">
            <div className="flex items-center justify-between border-b border-rule bg-shell/75 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-ink-strong">
                {t("profiles.cloud.deleteTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setDeleteCloudOpen(false)}
                aria-label={t("common.close")}
                className="grid size-7 place-items-center rounded-lg border border-rule bg-well text-muted transition hover:border-rule-strong hover:text-ink-strong"
              >
                <X size={15} />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-xs leading-5 text-muted">
                {t("profiles.cloud.deleteConfirm")}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setDeleteCloudOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="danger"
                  disabled={syncBusy}
                  onClick={() => {
                    setDeleteCloudOpen(false);
                    setSyncBusy(true);
                    void runtime
                      .deleteCloudBackup()
                      .catch(() => undefined)
                      .finally(() => setSyncBusy(false));
                  }}
                >
                  <Trash2 size={14} />
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
