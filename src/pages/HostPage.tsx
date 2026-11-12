import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Terminal,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Badge, Button, Card, Toggle } from "../components/ui";
import { webHostNative, type WebHostStatus } from "../services/native";
import { isTauri } from "../lib/utils";

export function HostPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WebHostStatus | null>(null);
  const [portInput, setPortInput] = useState("48950");
  const [tokenInput, setTokenInput] = useState("");
  const [qrSvg, setQrSvg] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const next = await webHostNative.status();
      setStatus(next);
      setPortInput(String(next.port));
      setTokenInput(next.token);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadStatus();
    if (!isTauri()) return;
    const id = window.setInterval(() => {
      void webHostNative.status().then(setStatus).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  const primaryUrl = status?.urls[0] ?? "";

  useEffect(() => {
    if (!primaryUrl || !status?.running) {
      setQrSvg("");
      return;
    }
    let cancelled = false;
    void QRCode.toString(primaryUrl, {
      type: "svg",
      margin: 1,
      width: 196,
      color: { dark: "#0b0c0f", light: "#ffffff" },
    }).then((svg) => {
      if (!cancelled) setQrSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [primaryUrl, status?.running]);

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
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          {status.lastError}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* QR Code & Mobile Access */}
        <Card className="lg:col-span-5">
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
                <Smartphone size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold">{t("host.mobileTitle")}</h2>
                <p className="text-xs text-muted">{t("host.mobileDescription")}</p>
              </div>
            </div>

            {status?.running && qrSvg ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-black/25 p-4">
                <div
                  className="overflow-hidden rounded-xl bg-white p-2.5 shadow-lg"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div className="w-full space-y-2">
                  {status.urls.map((url, idx) => (
                    <div
                      key={url}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-black/30 px-3 py-2 text-xs"
                    >
                      <span className="truncate font-mono text-zinc-200">{url}</span>
                      <button
                        type="button"
                        onClick={() => void copyText(`url-${idx}`, url)}
                        className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
                        title={t("host.copy")}
                      >
                        {copiedKey === `url-${idx}` ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-black/20 px-4 py-10 text-center">
                <Globe size={28} className="text-zinc-500" />
                <div className="text-xs font-medium text-zinc-300">{t("host.disabledHintTitle")}</div>
                <p className="max-w-xs text-[11px] text-muted">{t("host.disabledHintBody")}</p>
              </div>
            )}
          </div>
        </Card>

        {/* Host Configuration & Headless CLI */}
        <div className="space-y-4 lg:col-span-7">
          <Card>
            <form onSubmit={handleSaveSettings} className="space-y-4 p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-black/30 text-zinc-300">
                  <Server size={16} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{t("host.serverTitle")}</h2>
                  <p className="text-xs text-muted">{t("host.serverDescription")}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">
                    {t("host.portLabel")}
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    className="input w-full font-mono text-xs"
                    value={portInput}
                    onChange={(e) => setPortInput(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-zinc-300">
                    {t("host.tokenLabel")}
                  </label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <KeyRound
                        size={13}
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500"
                      />
                      <input
                        type="text"
                        className="input input-leading-icon w-full font-mono text-xs"
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

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-black/20 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck size={15} className="text-emerald-400" />
                  <div>
                    <div className="text-xs font-medium text-zinc-200">{t("host.requireAuthLabel")}</div>
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
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-black/30 text-zinc-300">
                  <Terminal size={16} />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{t("host.headlessTitle")}</h2>
                  <p className="text-xs text-muted">{t("host.headlessDescription")}</p>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                {[
                  { id: "cli1", cmd: "streamdash --headless" },
                  { id: "cli2", cmd: `streamdash --headless --port ${status?.port ?? 48950}` },
                  { id: "cli3", cmd: "xvfb-run -a streamdash --headless" },
                ].map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-black/25 px-3 py-2"
                  >
                    <code className="truncate font-mono text-[11px] text-zinc-200">{item.cmd}</code>
                    <button
                      type="button"
                      onClick={() => void copyText(item.id, item.cmd)}
                      className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
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
    </div>
  );
}
