import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Badge, Button, Card, Toggle } from "../components/ui";
import { webHostNative, type WebHostStatus } from "../services/native";
import { isTauri } from "../lib/utils";

const RELEASE_APK_URL =
  "https://github.com/Tenkayro/StreamDash/releases/latest/download/StreamDash-Android.apk";

export function HostPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WebHostStatus | null>(null);
  const [portInput, setPortInput] = useState("48950");
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [hasLocalDevApk, setHasLocalDevApk] = useState(false);
  const [appSource, setAppSource] = useState<"release" | "dev">("release");
  const [appQrResult, setAppQrResult] = useState<{ url: string; svg: string }>({
    url: "",
    svg: "",
  });

  useEffect(() => {
    let active = true;
    const syncStatus = () =>
      void webHostNative
        .status()
        .then((next) => {
          if (!active) return;
          setStatus(next);
          setPortInput((prev) => (prev === "48950" ? String(next.port) : prev));
          setTokenInput((prev) => (prev ? prev : next.token));
        })
        .catch(() => undefined);

    syncStatus();
    if (!isTauri()) {
      return () => {
        active = false;
      };
    }
    const id = window.setInterval(() => {
      void webHostNative
        .status()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const primaryUrl = status?.urls[0] ?? "";
  const [qrResult, setQrResult] = useState<{ url: string; svg: string }>({
    url: "",
    svg: "",
  });

  useEffect(() => {
    if (!primaryUrl || !status?.running) return;
    let cancelled = false;
    void QRCode.toString(primaryUrl, {
      type: "svg",
      margin: 1,
      width: 196,
      color: { dark: "#0b0c0f", light: "#ffffff" },
    }).then((svg) => {
      if (!cancelled) setQrResult({ url: primaryUrl, svg });
    });
    return () => {
      cancelled = true;
    };
  }, [primaryUrl, status?.running]);

  const qrSvg =
    primaryUrl && status?.running && qrResult.url === primaryUrl ? qrResult.svg : "";

  useEffect(() => {
    if (!appModalOpen || !status?.running) return;
    let cancelled = false;
    const headers: HeadersInit =
      status.requireAuth && status.token ? { "X-SD-Token": status.token } : {};
    const devBase = isTauri() ? `http://127.0.0.1:${status.port}` : "";
    void fetch(`${devBase}/api/dev-apk-info`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { available?: boolean } | null) => {
        if (!cancelled) {
          setHasLocalDevApk(Boolean(data?.available));
        }
      })
      .catch(() => {
        if (!cancelled) setHasLocalDevApk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appModalOpen, status?.running, status?.port, status?.requireAuth, status?.token]);

  const effectiveSource =
    appSource === "dev" && appModalOpen && hasLocalDevApk && status?.running ? "dev" : "release";
  const localDevIp = status?.localIps[0] ?? "";
  const localDevApkUrl =
    status?.running && localDevIp
      ? `http://${localDevIp}:${status.port}/api/dev-apk${
          status.requireAuth && status.token ? `?token=${encodeURIComponent(status.token)}` : ""
        }`
      : "";
  const appDownloadUrl =
    effectiveSource === "dev" && localDevApkUrl ? localDevApkUrl : RELEASE_APK_URL;

  useEffect(() => {
    if (!appModalOpen || !appDownloadUrl) return;
    let cancelled = false;
    void QRCode.toString(appDownloadUrl, {
      type: "svg",
      margin: 1,
      width: 196,
      color: { dark: "#0b0c0f", light: "#ffffff" },
    }).then((svg) => {
      if (!cancelled) setAppQrResult({ url: appDownloadUrl, svg });
    });
    return () => {
      cancelled = true;
    };
  }, [appModalOpen, appDownloadUrl]);

  useEffect(() => {
    if (!appModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAppModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appModalOpen]);

  const appQrSvg = appQrResult.url === appDownloadUrl ? appQrResult.svg : "";

  const applyConfig = async (next: {
    enabled: boolean;
    port: number;
    requireAuth: boolean;
    token?: string;
  }) => {
    setBusy(true);
    try {
      const updated = await webHostNative.configure(next);
      setStatus(updated);
      setPortInput(String(updated.port));
      setTokenInput(updated.token);
      toast.success(
        updated.running ? t("host.startedToast") : t("host.stoppedToast"),
      );
    } catch (error) {
      toast.error(t("host.configError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!status) return;
    const parsedPort = Number.parseInt(portInput, 10);
    const port = Number.isFinite(parsedPort) && parsedPort >= 1024 && parsedPort <= 65535
      ? parsedPort
      : 48950;
    void applyConfig({
      enabled: status.enabled,
      port,
      requireAuth: status.requireAuth,
      token: tokenInput.trim() || undefined,
    });
  };

  const handleRegenerateToken = async () => {
    setBusy(true);
    try {
      const updated = await webHostNative.regenerateToken();
      setStatus(updated);
      setTokenInput(updated.token);
      toast.success(t("host.tokenRegenerated"));
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(t("host.copiedToast"));
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">{t("host.title")}</h1>
            {status?.running ? (
              <Badge tone="green">{t("host.statusRunning")}</Badge>
            ) : (
              <Badge tone="neutral">{t("host.statusStopped")}</Badge>
            )}
            {status?.headless && <Badge tone="purple">{t("host.headlessBadge")}</Badge>}
            {status?.running && (
              <Badge tone="neutral">
                {t("host.clientsConnected", { count: status.connectedClients })}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{t("host.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => setAppModalOpen(true)}
          >
            <Download size={14} />
            {t("host.mobileAppButton")}
          </Button>
          {status?.running && primaryUrl && (
            <Button
              type="button"
              onClick={() => void openUrl(primaryUrl)}
            >
              <ExternalLink size={14} />
              {t("host.openBrowser")}
            </Button>
          )}
          <Toggle
            value={Boolean(status?.enabled)}
            onChange={(enabled) => {
              if (!status || busy) return;
              void applyConfig({
                enabled,
                port: status.port,
                requireAuth: status.requireAuth,
                token: status.token,
              });
            }}
          />
        </div>
      </div>

      {status?.lastError && (
        <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {status.lastError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* QR Code & Mobile Access */}
        <Card className="lg:col-span-5">
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg border border-accent-border bg-accent-soft text-accent">
                <Smartphone size={15} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-ink-strong">{t("host.mobileTitle")}</h2>
                <p className="text-xs text-muted">{t("host.mobileDescription")}</p>
              </div>
            </div>

            {status?.running && qrSvg ? (
              <div className="flex flex-col items-center gap-3 rounded-[10px] border border-rule bg-well p-4">
                <div
                  className="overflow-hidden rounded-[10px] bg-white p-2.5 shadow-lg"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div className="w-full space-y-2">
                  {status.urls.map((url, idx) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-2 rounded-lg border border-rule bg-panel px-3 py-2 text-xs"
                    >
                      <span className="studio-mono truncate text-ink">{url}</span>
                      <button
                        type="button"
                        onClick={() => void copyText(`url-${idx}`, url)}
                        className="shrink-0 rounded p-1 text-muted transition hover:bg-hover hover:text-ink-strong"
                        title={t("host.copy")}
                        aria-label={t("host.copy")}
                      >
                        {copiedKey === `url-${idx}` ? <Check size={13} className="text-emerald-400" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-rule bg-well px-4 py-10 text-center">
                <Globe size={28} className="text-subtle" />
                <div className="text-xs font-medium text-ink">{t("host.disabledHintTitle")}</div>
                <p className="max-w-xs text-[11px] text-muted">{t("host.disabledHintBody")}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Host Configuration & Headless CLI */}
        <div className="space-y-4 lg:col-span-7">
          <Card>
            <form onSubmit={handleSaveSettings} className="space-y-4 p-5">
              <div className="flex items-center gap-2.5 border-b border-rule pb-3">
                <Server size={15} className="text-muted" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-ink-strong">{t("host.serverTitle")}</h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="studio-label block">
                    {t("host.portLabel")}
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    className="input studio-mono w-full text-xs"
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="studio-label block">
                    {t("host.tokenLabel")}
                  </label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <KeyRound
                        size={13}
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
                      />
                      <input
                        type="text"
                        className="input input-leading-icon studio-mono w-full text-xs"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        disabled={!status?.requireAuth}
                      />
                    </div>
                    <Button
                      type="button"
                      disabled={busy || !status?.requireAuth}
                      onClick={() => void handleRegenerateToken()}
                      title={t("host.regenerateToken")}
                    >
                      <RefreshCw size={13} />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-rule bg-well px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={15} className="text-emerald-400" />
                  <div>
                    <div className="text-xs font-medium text-ink-strong">{t("host.requireAuthLabel")}</div>
                    <div className="text-[11px] text-muted">{t("host.requireAuthHint")}</div>
                  </div>
                </div>
                <Toggle
                  value={Boolean(status?.requireAuth)}
                  onChange={(requireAuth) => {
                    if (!status || busy) return;
                    void applyConfig({
                      enabled: status.enabled,
                      port: status.port,
                      requireAuth,
                      token: status.token,
                    });
                  }}
                />
              </div>

              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={busy || !status}>
                  {t("host.saveButton")}
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <div className="space-y-3 p-5">
              <div className="flex items-center gap-2.5 border-b border-rule pb-3">
                <Terminal size={15} className="text-muted" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-ink-strong">{t("host.headlessTitle")}</h2>
              </div>

              <div className="space-y-2 text-xs">
                {[
                  { id: "cli1", cmd: "streamdash --headless" },
                  { id: "cli2", cmd: `streamdash --headless --port ${status?.port ?? 48950}` },
                  { id: "cli3", cmd: "xvfb-run -a streamdash --headless" },
                ].map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-rule bg-well px-3 py-2"
                  >
                    <code className="studio-mono truncate text-[11px] text-ink">{item.cmd}</code>
                    <button
                      type="button"
                      onClick={() => void copyText(item.id, item.cmd)}
                      className="shrink-0 rounded p-1 text-muted transition hover:bg-hover hover:text-ink-strong"
                    >
                      {copiedKey === item.id ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {appModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setAppModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="host-mobile-app-title"
        >
          <div
            className="glass-panel w-full max-w-sm rounded-[14px] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg border border-accent-border bg-accent-soft text-accent">
                  <Smartphone size={15} />
                </span>
                <div>
                  <h2 id="host-mobile-app-title" className="text-sm font-semibold text-ink-strong">
                    {t("host.appModalTitle")}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted">{t("host.appModalHint")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAppModalOpen(false)}
                className="rounded-lg p-1 text-muted transition hover:bg-hover hover:text-ink-strong"
                aria-label={t("host.appClose")}
              >
                <X size={15} />
              </button>
            </div>

            {hasLocalDevApk && localDevApkUrl && (
              <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-[10px] border border-rule bg-well p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setAppSource("release")}
                  className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                    effectiveSource === "release"
                      ? "bg-panel text-ink-strong shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {t("host.appSourceRelease")}
                </button>
                <button
                  type="button"
                  onClick={() => setAppSource("dev")}
                  className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                    effectiveSource === "dev"
                      ? "bg-panel text-ink-strong shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {t("host.appSourceDev")}
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-col items-center gap-3 rounded-[10px] border border-rule bg-well p-4">
              {appQrSvg && (
                <div
                  className="overflow-hidden rounded-[10px] bg-white p-2.5 shadow-lg"
                  dangerouslySetInnerHTML={{ __html: appQrSvg }}
                />
              )}
              <div className="flex w-full items-center justify-between gap-2 rounded-lg border border-rule bg-panel px-3 py-2 text-xs">
                <span className="studio-mono truncate text-ink">{appDownloadUrl}</span>
                <button
                  type="button"
                  onClick={() => void copyText("apk-url", appDownloadUrl)}
                  className="shrink-0 rounded p-1 text-muted transition hover:bg-hover hover:text-ink-strong"
                  title={t("host.copy")}
                  aria-label={t("host.copy")}
                >
                  {copiedKey === "apk-url" ? (
                    <Check size={13} className="text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Copy size={13} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" onClick={() => setAppModalOpen(false)}>
                {t("host.appClose")}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => void openUrl(appDownloadUrl)}
              >
                <Download size={14} />
                {t("host.appDownloadApk")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
