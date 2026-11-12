import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CheckCircle2,
  Cloud,
  Copy,
  Crown,
  ExternalLink,
  KeyRound,
  LifeBuoy,
  Link2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge, Button, Card } from "./ui";
import { PAYHIP_PRO_URL, mapProError } from "../lib/pro";
import { errorMessage } from "../lib/utils";
import { useRuntime } from "../services/runtime-context";
import { useAppStore } from "../stores/app-store";

export function ProModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <ProModalContent onClose={onClose} />;
}

function ProModalContent({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const runtime = useRuntime();
  const twitch = useAppStore((s) => s.twitch);
  const entitlements = useAppStore((s) => s.entitlements);
  const setPage = useAppStore((s) => s.setPage);

  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const twitchConnected = twitch.phase === "connected" && Boolean(twitch.userId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleActivate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = licenseKey.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await runtime.activateProLicense(trimmed);
      setLicenseKey("");
      onClose();
    } catch (err) {
      setError(mapProError(errorMessage(err), t));
    } finally {
      setBusy(false);
    }
  };

  const openSupportReset = () => {
    onClose();
    setPage("settings");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("streamdash:open-support"));
      document.getElementById("support")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xs"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-lg overflow-hidden border-line bg-surface p-0 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-gradient-to-r from-[#9146ff]/12 via-accent/10 to-transparent px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/15 text-amber-300">
              <Crown size={16} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {t("pro.title")}
                </h3>
                <Badge tone={entitlements.pro ? "green" : "purple"}>
                  {entitlements.pro ? t("pro.badgeActive") : t("pro.badgeOneTime")}
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-400">{t("pro.subtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="grid size-7 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {!twitchConnected ? (
            <div className="space-y-3 rounded-xl border border-line bg-black/20 p-4">
              <div className="flex items-start gap-3">
                <Link2 size={16} className="mt-0.5 shrink-0 text-[#b98cff]" />
                <div className="text-xs leading-5 text-zinc-300">
                  {t("pro.twitchRequiredDetail")}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  onClick={() => {
                    onClose();
                    setPage("connections");
                  }}
                >
                  {t("chat.openConnections")}
                </Button>
              </div>
            </div>
          ) : entitlements.pro ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300" />
                  <div className="min-w-0 flex-1 space-y-1 text-xs">
                    <div className="font-semibold text-emerald-200">
                      {t("pro.activeForAccount", { account: twitch.account ?? "" })}
                    </div>
                    <div className="text-zinc-400">
                      {t("pro.licenseSummary", {
                        key: entitlements.license?.maskedKey ?? "••••",
                        date: entitlements.license?.activatedAt
                          ? new Date(entitlements.license.activatedAt).toLocaleDateString()
                          : "—",
                      })}
                    </div>
                    {entitlements.license?.keyId && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-zinc-400">{t("pro.keyIdLabel")}:</span>
                        <code className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[11px] text-emerald-200">
                          {entitlements.license.keyId}
                        </code>
                        <button
                          type="button"
                          onClick={() => {
                            const id = entitlements.license?.keyId;
                            if (!id) return;
                            void navigator.clipboard.writeText(id).then(() => {
                              toast.success(t("pro.keyIdCopied"));
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded border border-line bg-white/5 px-1.5 py-0.5 text-[11px] text-zinc-200 transition hover:bg-white/10"
                          title={t("pro.keyIdLabel")}
                        >
                          <Copy size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-line bg-black/20 p-3.5 text-xs">
                <div className="flex items-center gap-2 text-zinc-200">
                  <Cloud size={14} className="text-accent" />
                  <span>{t("pro.perks.cloudSync")}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  <span>{t("pro.perks.twitchBound", { account: twitch.account ?? "" })}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  <Sparkles size={14} className="text-[#b98cff]" />
                  <span>{t("pro.perks.futureFeatures")}</span>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {error}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  onClick={openSupportReset}
                  className="hover:border-amber-500/30 hover:text-amber-200"
                >
                  <LifeBuoy size={13} />
                  {t("pro.requestResetButton")}
                </Button>
                <Button variant="primary" onClick={onClose}>
                  {t("common.done")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2.5 rounded-xl border border-line bg-black/20 p-3.5 text-xs">
                <div className="flex items-center gap-2 text-zinc-200">
                  <Cloud size={14} className="shrink-0 text-accent" />
                  <span>{t("pro.perks.cloudSync")}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  <ShieldCheck size={14} className="shrink-0 text-emerald-400" />
                  <span>{t("pro.perks.twitchBound", { account: twitch.account ?? "" })}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-200">
                  <Sparkles size={14} className="shrink-0 text-[#b98cff]" />
                  <span>{t("pro.perks.futureFeatures")}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft/30 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-zinc-100">
                    {t("pro.buyCardTitle")}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {t("pro.buyCardDetail")}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void openUrl(PAYHIP_PRO_URL)}
                >
                  <ExternalLink size={13} />
                  {t("pro.getProButton")}
                </Button>
              </div>

              <form onSubmit={(e) => void handleActivate(e)} className="space-y-2.5">
                <label className="block text-xs font-medium text-zinc-300">
                  {t("pro.licenseKeyLabel")}
                </label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <KeyRound
                      size={14}
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-500"
                    />
                    <input
                      autoFocus
                      className="input input-leading-icon font-mono text-xs"
                      placeholder={t("pro.licenseKeyPlaceholder")}
                      value={licenseKey}
                      onChange={(event) => {
                        setLicenseKey(event.target.value);
                        setError(undefined);
                      }}
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !licenseKey.trim()}
                  >
                    {busy ? t("pro.activating") : t("pro.activateButton")}
                  </Button>
                </div>
                {error && (
                  <p className="text-xs text-red-300">{error}</p>
                )}
              </form>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
