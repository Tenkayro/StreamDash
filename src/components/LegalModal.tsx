import { ExternalLink, FileText, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card } from "./ui";
import { openLegalPage, PRO_PRIVACY_URL, PRO_TERMS_URL } from "../lib/pro";

export type LegalTab = "terms" | "privacy";

const TERMS_KEYS = ["s1", "s2", "s3", "s4", "s5"] as const;
const PRIVACY_KEYS = ["p1", "p2", "p3", "p4"] as const;

/**
 * Displays localized Terms of Service / No-Refund Policy and Privacy Policy inside the app.
 */
export function LegalModal({
  open,
  initialTab = "terms",
  onClose,
}: {
  open: boolean;
  initialTab?: LegalTab;
  onClose: () => void;
}) {
  if (!open) return null;
  return <LegalModalContent key={initialTab} initialTab={initialTab} onClose={onClose} />;
}

function LegalModalContent({
  initialTab,
  onClose,
}: {
  initialTab: LegalTab;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LegalTab>(initialTab);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const activeUrl = tab === "terms" ? PRO_TERMS_URL : PRO_PRIVACY_URL;

  return (
    <div
      className="fixed inset-0 z-60 grid place-items-center bg-black/75 p-4 backdrop-blur-xs"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border-rule-strong bg-panel p-0 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-well px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border border-rule-strong bg-panel text-accent">
              {tab === "terms" ? <FileText size={15} /> : <ShieldCheck size={15} />}
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink-strong">
                  {tab === "terms" ? t("legal.termsTab") : t("legal.privacyTab")}
                </h3>
                <Badge tone="neutral">{t("legal.updatedLabel")}</Badge>
              </div>
              <p className="text-[11px] text-muted">{t("legal.modalSubtitle")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-7 place-items-center rounded-md text-subtle transition hover:bg-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex gap-2 border-b border-line bg-well/60 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setTab("terms")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === "terms"
                ? "border-accent-border bg-accent-soft text-ink-strong"
                : "border-rule bg-panel text-muted hover:border-rule-strong hover:text-ink"
            }`}
          >
            <FileText size={13} />
            {t("legal.termsTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("privacy")}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === "privacy"
                ? "border-accent-border bg-accent-soft text-ink-strong"
                : "border-rule bg-panel text-muted hover:border-rule-strong hover:text-ink"
            }`}
          >
            <ShieldCheck size={13} />
            {t("legal.privacyTab")}
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {tab === "terms"
            ? TERMS_KEYS.map((key) => (
                <div
                  key={key}
                  className="space-y-1 rounded-[10px] border border-rule bg-well px-4 py-3"
                >
                  <h4 className="text-xs font-semibold text-ink-strong">
                    {t(`legal.termsSections.${key}Title`)}
                  </h4>
                  <p className="text-xs leading-relaxed text-ink/90">
                    {t(`legal.termsSections.${key}Body`)}
                  </p>
                </div>
              ))
            : PRIVACY_KEYS.map((key) => (
                <div
                  key={key}
                  className="space-y-1 rounded-[10px] border border-rule bg-well px-4 py-3"
                >
                  <h4 className="text-xs font-semibold text-ink-strong">
                    {t(`legal.privacySections.${key}Title`)}
                  </h4>
                  <p className="text-xs leading-relaxed text-ink/90">
                    {t(`legal.privacySections.${key}Body`)}
                  </p>
                </div>
              ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-well px-5 py-3">
          <Button type="button" onClick={() => void openLegalPage(activeUrl)}>
            <ExternalLink size={13} />
            {t("legal.openWebsite")}
          </Button>
          <Button type="button" variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
