import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Check, ShieldCheck, Smartphone, X } from "lucide-react";
import { Badge, Button } from "./ui";
import { isTauri } from "../lib/utils";
import { webHostNative, type WebHostPairRequest } from "../services/native";

interface QueuedPairRequest extends WebHostPairRequest {
  expiresAtMs: number;
}

function toQueued(req: WebHostPairRequest): QueuedPairRequest {
  const ttlMs = Math.max(5, req.expiresInSec || 60) * 1000;
  return { ...req, expiresAtMs: Date.now() + ttlMs };
}

export function HostPairDialog() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueuedPairRequest[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;

    void webHostNative
      .pendingPairRequests()
      .then((items) => {
        if (!active || !items.length) return;
        setQueue(items.map(toQueued));
        setNowMs(Date.now());
      })
      .catch(() => undefined);

    const p1 = listen<WebHostPairRequest>("web-host-pair-request", (event) => {
      if (!active || !event.payload?.requestId) return;
      const item = toQueued(event.payload);
      setNowMs(Date.now());
      setQueue((prev) =>
        prev.some((existing) => existing.requestId === item.requestId)
          ? prev
          : [...prev, item],
      );
    });

    const p2 = listen<{ requestId?: string }>(
      "web-host-pair-resolved",
      (event) => {
        const resolvedId = event.payload?.requestId;
        if (!active || !resolvedId) return;
        setQueue((prev) =>
          prev.filter((item) => item.requestId !== resolvedId),
        );
        setBusyId((prev) => (prev === resolvedId ? null : prev));
      },
    );

    return () => {
      active = false;
      void p1.then((fn) => fn());
      void p2.then((fn) => fn());
    };
  }, []);

  const current = queue[0];

  const hasPending = queue.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const id = window.setInterval(() => {
      const ts = Date.now();
      setNowMs(ts);
      setQueue((prev) => prev.filter((item) => item.expiresAtMs > ts));
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasPending]);

  const handleRespond = async (approve: boolean) => {
    if (!current || busyId === current.requestId) return;
    const requestId = current.requestId;
    setBusyId(requestId);
    try {
      await webHostNative.respondPairRequest(requestId, approve);
    } finally {
      setQueue((prev) => prev.filter((item) => item.requestId !== requestId));
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleRespond(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!current) return null;

  const remainingSec = Math.max(
    1,
    Math.ceil((current.expiresAtMs - nowMs) / 1000),
  );
  const busy = busyId === current.requestId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-pair-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent">
              <Smartphone size={20} />
            </div>
            <div>
              <h2
                id="host-pair-title"
                className="text-base font-semibold text-ink"
              >
                {t("host.pairConfirmTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {t("host.pairConfirmSubtitle", { device: current.deviceName })}
              </p>
            </div>
          </div>
          <Badge tone="neutral">
            {t("host.pairExpiresIn", { seconds: remainingSec })}
          </Badge>
        </div>

        <div className="mt-4 rounded-xl border border-accent/35 bg-surface/80 px-4 py-4 text-center">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted uppercase">
            <ShieldCheck size={13} className="text-accent" />
            <span>{t("host.pairCodeLabel")}</span>
          </div>
          <div className="mt-2 font-mono text-3xl font-bold tracking-[0.22em] text-ink tabular-nums">
            {current.verifyCode}
          </div>
        </div>

        <p className="mt-3 text-center text-xs leading-relaxed text-muted">
          {t("host.pairConfirmHint")}
        </p>

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <Button
            variant="default"
            disabled={busy}
            onClick={() => void handleRespond(false)}
          >
            <X size={15} />
            {t("host.pairDecline")}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void handleRespond(true)}
          >
            <Check size={15} />
            {t("host.pairConfirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
