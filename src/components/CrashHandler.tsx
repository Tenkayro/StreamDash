import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  RotateCcw,
  X,
} from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui";
import { useAppStore } from "../stores/app-store";
import {
  formatCrashReport,
  installGlobalCrashHandlers,
  useCrashStore,
} from "../stores/crash-store";

interface BoundaryProps {
  children: ReactNode;
  fatal?: boolean;
  resetKey?: string;
}

interface BoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

export class CrashBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || error.name || "Render error",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    useCrashStore.getState().reportCrash({
      kind: "react",
      message: error.message || error.name || "Render error",
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      page: useAppStore.getState().page,
      fatal: this.props.fatal,
    });
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: undefined });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <BoundaryFallback
          fatal={Boolean(this.props.fatal)}
          errorMessage={this.state.errorMessage}
          onRetry={() => this.setState({ hasError: false, errorMessage: undefined })}
        />
      );
    }
    return this.props.children;
  }
}

function BoundaryFallback({
  fatal,
  errorMessage,
  onRetry,
}: {
  fatal: boolean;
  errorMessage?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[280px] flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-400/25 bg-card p-6 text-center shadow-2xl">
        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl border border-red-400/30 bg-red-400/12 text-red-300">
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold text-ink">
          {fatal ? t("crash.fatalTitle") : t("crash.pageTitle")}
        </h2>
        <p className="mt-1.5 text-xs leading-5 text-muted">
          {t("crash.description")}
        </p>
        {errorMessage && (
          <p className="mt-3 truncate rounded-lg border border-line bg-black/25 px-3 py-2 font-mono text-[11px] text-red-200">
            {errorMessage}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {!fatal && (
            <Button variant="ghost" onClick={onRetry}>
              <RotateCcw size={14} />
              {t("crash.retrySection")}
            </Button>
          )}
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RotateCcw size={14} />
            {t("crash.reloadApp")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CrashDialog() {
  const { t } = useTranslation();
  const activeCrash = useCrashStore((state) => state.activeCrash);
  const history = useCrashStore((state) => state.history);
  const dismissCrash = useCrashStore((state) => state.dismissCrash);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    installGlobalCrashHandlers(() => useAppStore.getState().page);
  }, []);

  useEffect(() => {
    setDetailsOpen(false);
    setCopied(false);
  }, [activeCrash?.id]);

  if (!activeCrash) return null;

  const fullReport = formatCrashReport(activeCrash, history);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullReport);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownloadLog = () => {
    const blob = new Blob([fullReport], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `streamdash-crash-${activeCrash.timestamp.slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="crash-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-red-400/30 bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-red-400/30 bg-red-400/12 text-red-300">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div>
              <h2 id="crash-dialog-title" className="text-sm font-semibold text-ink">
                {activeCrash.fatal ? t("crash.fatalTitle") : t("crash.title")}
              </h2>
              <p className="mt-0.5 text-xs text-muted">{t("crash.description")}</p>
            </div>
          </div>
          {!activeCrash.fatal && (
            <button
              type="button"
              onClick={dismissCrash}
              aria-label={t("crash.dismiss")}
              className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-hover hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-red-400/20 bg-red-400/8 px-3.5 py-2.5">
            <div className="text-[11px] font-medium text-red-200/80">
              {activeCrash.kind.toUpperCase()}
              {activeCrash.page ? ` · ${activeCrash.page}` : ""}
            </div>
            <p className="mt-1 wrap-break-word font-mono text-xs text-red-100">
              {activeCrash.message}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-lg border border-line bg-well px-3 py-2 text-xs font-medium text-muted transition hover:text-ink"
          >
            <span>{t("crash.technicalDetails")}</span>
            {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {detailsOpen && (
            <pre className="max-h-60 overflow-auto rounded-xl border border-line bg-black/35 p-3 font-mono text-[11px] leading-relaxed text-zinc-300 select-text">
              {fullReport}
            </pre>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-well px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => void handleCopy()}>
              {copied ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
              {copied ? t("crash.copied") : t("crash.copyReport")}
            </Button>
            <Button variant="ghost" onClick={handleDownloadLog}>
              <Download size={14} />
              {t("crash.saveLog")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {!activeCrash.fatal && (
              <Button variant="ghost" onClick={dismissCrash}>
                {t("crash.dismiss")}
              </Button>
            )}
            <Button variant="primary" onClick={() => window.location.reload()}>
              <RotateCcw size={14} />
              {t("crash.reloadApp")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
