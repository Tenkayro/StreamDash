import { RefreshCw, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetworkStore } from "../stores/network-store";
import { cn } from "../lib/utils";

export function OfflineBanner({
  description,
  className,
}: {
  description?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const online = useNetworkStore((state) => state.online);
  const checking = useNetworkStore((state) => state.checking);
  const checkNow = useNetworkStore((state) => state.checkNow);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <WifiOff size={15} className="shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-amber-100">{t("network.offlineTitle")}</p>
          <p className="text-[11px] text-amber-200/80">
            {description ?? t("network.offlineDescription")}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={checking}
        onClick={() => void checkNow()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-300/15 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition hover:bg-amber-300/25 disabled:opacity-50"
      >
        <RefreshCw size={11} className={checking ? "animate-spin" : undefined} aria-hidden="true" />
        <span>{t("network.retry")}</span>
      </button>
    </div>
  );
}
