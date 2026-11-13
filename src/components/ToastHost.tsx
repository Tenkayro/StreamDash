import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { Toaster } from "sonner";

export function ToastHost() {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      gap={8}
      offset={{ bottom: 16, right: 16 }}
      visibleToasts={4}
      closeButton
      icons={{
        success: <CheckCircle2 size={15} className="text-emerald-400" />,
        error: <AlertCircle size={15} className="text-red-400" />,
        warning: <AlertTriangle size={15} className="text-amber-400" />,
        info: <Info size={15} className="text-sky-400" />,
        loading: <Loader2 size={15} className="animate-spin text-violet-400" />,
        close: <X size={12} />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 4200,
        classNames: {
          toast:
            "group pointer-events-auto relative flex w-[340px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-[10px] border border-rule-strong bg-panel/95 px-3.5 py-3 text-ink shadow-[0_18px_44px_-12px_rgba(0,0,0,0.88)] backdrop-blur-xl transition-[transform,opacity]",
          title: "text-[12.5px] font-semibold leading-4.5 text-ink-strong",
          description: "mt-0.5 text-[11px] leading-4 text-muted",
          content: "min-w-0 flex-1 pr-4",
          icon: "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[7px] border border-rule bg-well",
          closeButton:
            "absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-md text-subtle opacity-0 transition hover:bg-hover hover:text-ink group-hover:opacity-100",
          actionButton:
            "mt-2 inline-flex h-6 items-center rounded-md border border-accent-border bg-accent-soft px-2 text-[11px] font-medium text-accent transition hover:brightness-115",
          cancelButton:
            "mt-2 inline-flex h-6 items-center rounded-md border border-rule bg-raised px-2 text-[11px] font-medium text-ink transition hover:bg-hover",
          success:
            "border-emerald-500/30! [&_[data-icon]]:bg-emerald-500/15",
          error: "border-red-500/35! [&_[data-icon]]:bg-red-500/15",
          warning: "border-amber-500/35! [&_[data-icon]]:bg-amber-500/15",
          info: "border-sky-500/30! [&_[data-icon]]:bg-sky-500/15",
          loading: "border-violet-500/30! [&_[data-icon]]:bg-violet-500/15",
        },
      }}
    />
  );
}
