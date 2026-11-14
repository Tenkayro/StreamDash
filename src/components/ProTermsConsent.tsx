import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LegalTab } from "./LegalModal";

/**
 * Shared legal acceptance checkbox gating StreamDash Pro checkout and key activation.
 */
export function ProTermsConsent({
  id,
  accepted,
  onChange,
  onOpenLegal,
}: {
  id: string;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  onOpenLegal: (tab: LegalTab) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`space-y-1.5 rounded-[10px] border px-3.5 py-2.5 text-xs transition ${
        accepted
          ? "border-emerald-500/30 bg-emerald-500/8"
          : "border-rule bg-well"
      }`}
    >
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
        <input
          id={id}
          type="checkbox"
          checked={accepted}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-emerald-400"
        />
        <span className="leading-relaxed text-ink">
          {t("pro.legalConsentPrefix")}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenLegal("terms");
            }}
            className="font-semibold text-accent underline underline-offset-2 transition hover:text-ink-strong"
          >
            {t("pro.termsLink")}
          </button>
          {t("pro.legalConsentAnd")}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenLegal("privacy");
            }}
            className="font-semibold text-accent underline underline-offset-2 transition hover:text-ink-strong"
          >
            {t("pro.privacyLink")}
          </button>
          {t("pro.legalConsentSuffix")}
        </span>
      </label>
      {!accepted && (
        <div className="flex items-center gap-1.5 pl-6 text-[11px] text-amber-200/85">
          <ShieldCheck size={12} className="shrink-0" />
          <span>{t("pro.acceptTermsHint")}</span>
        </div>
      )}
    </div>
  );
}
