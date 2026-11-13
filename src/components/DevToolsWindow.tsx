import {
  Check,
  Copy,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DEV_CHANNEL_NAME,
  type DevCommand,
  type DevStateSnapshot,
} from "../lib/dev-bridge";

const QUICK_PAGES = [
  "dashboard",
  "chat",
  "activity",
  "giveaways",
  "commands",
  "variables",
  "alerts",
  "rewards",
  "goals",
  "live",
  "stream",
  "connections",
  "settings",
  "pro",
  "about",
] as const;

const LANGUAGES = ["en", "de", "es", "fr", "pt-BR"] as const;

function ActionButton({
  label,
  onClick,
  tone = "default",
  active = false,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger" | "accent";
  active?: boolean;
}) {
  const styles =
    tone === "danger"
      ? "border-red-500/25 bg-red-500/10 text-red-300 hover:bg-red-500/20"
      : active || tone === "accent"
        ? "border-violet-500/35 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25"
        : "border-white/10 bg-white/4 text-zinc-200 hover:bg-white/8";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-md border px-2.5 text-[11px] font-medium transition cursor-pointer ${styles}`}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-white/8 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function DevToolsWindow() {
  const [snapshot, setSnapshot] = useState<DevStateSnapshot | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    document.title = "StreamDash DevTools";
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(DEV_CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (
      event: MessageEvent<{ type: string; snapshot?: DevStateSnapshot }>,
    ) => {
      if (event.data?.type === "state" && event.data.snapshot) {
        setSnapshot(event.data.snapshot);
      }
    };
    channel.postMessage({ type: "request-state" } satisfies DevCommand);

    const interval = window.setInterval(() => {
      channel.postMessage({ type: "request-state" } satisfies DevCommand);
    }, 2000);

    return () => {
      window.clearInterval(interval);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const send = (cmd: DevCommand) => {
    channelRef.current?.postMessage(cmd);
  };

  const copyCrash = async (id: string, report: string) => {
    try {
      await navigator.clipboard.writeText(report);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0e14] p-4 text-zinc-100 select-none">
      <div className="mx-auto flex max-w-lg flex-col gap-3.5">
        {/* Minimal Header */}
        <header className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                snapshot ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <h1 className="text-sm font-semibold text-white">DevTools</h1>
            <span className="text-[11px] text-zinc-500">
              {snapshot ? snapshot.page : "connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => send({ type: "request-state" })}
              title="Refresh"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/4 text-zinc-300 transition hover:bg-white/8 cursor-pointer"
            >
              <RefreshCw size={12} />
            </button>
            <ActionButton
              label="Reload"
              onClick={() => send({ type: "reload" })}
            />
          </div>
        </header>

        {/* Status Summary */}
        {snapshot && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-[11px] text-zinc-400">
            <span>
              Net:{" "}
              <strong
                className={
                  snapshot.online ? "text-emerald-400" : "text-red-400"
                }
              >
                {snapshot.online ? "online" : "offline"}
              </strong>
            </span>
            <span>
              Tier:{" "}
              <strong className="text-zinc-200">
                {snapshot.pro ? "pro" : "free"}
              </strong>
            </span>
            <span>
              Twitch:{" "}
              <strong className="text-zinc-200">
                {snapshot.connections.twitch.phase}
              </strong>
            </span>
            <span>
              OBS:{" "}
              <strong className="text-zinc-200">
                {snapshot.connections.obs.phase}
              </strong>
            </span>
          </div>
        )}

        {/* Controls: Network, Pro, Page, Locale */}
        <Section title="Environment">
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton
              label={snapshot?.online === false ? "Offline (ON)" : "Offline"}
              tone={snapshot?.online === false ? "danger" : "default"}
              onClick={() =>
                send({ type: "set-online", online: snapshot?.online === false })
              }
            />
            <ActionButton
              label="Probe Net"
              onClick={() => send({ type: "check-network" })}
            />
            <ActionButton
              label={snapshot?.pro ? "Pro: ON" : "Pro: OFF"}
              active={Boolean(snapshot?.pro)}
              onClick={() => send({ type: "set-pro", pro: !snapshot?.pro })}
            />
            <select
              aria-label="Language"
              value={snapshot?.language ?? "en"}
              onChange={(e) =>
                send({
                  type: "set-language",
                  language: e.target.value as (typeof LANGUAGES)[number],
                })
              }
              className="h-7 rounded-md border border-white/10 bg-[#141722] px-2 text-[11px] text-zinc-200 outline-none"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
            <select
              aria-label="Page"
              value={snapshot?.page ?? "dashboard"}
              onChange={(e) =>
                send({ type: "navigate", page: e.target.value })
              }
              className="h-7 rounded-md border border-white/10 bg-[#141722] px-2 text-[11px] text-zinc-200 outline-none"
            >
              {QUICK_PAGES.map((page) => (
                <option key={page} value={page}>
                  /{page}
                </option>
              ))}
            </select>
          </div>
        </Section>

        {/* Simulate */}
        <Section title="Simulate">
          <div className="flex flex-wrap gap-1.5">
            <ActionButton
              label="+Follow"
              onClick={() =>
                send({ type: "simulate-event", eventType: "follow" })
              }
            />
            <ActionButton
              label="+Raid"
              onClick={() =>
                send({ type: "simulate-event", eventType: "raid" })
              }
            />
            <ActionButton
              label="+Chat"
              onClick={() => send({ type: "simulate-chat" })}
            />
            <ActionButton
              label="Toast OK"
              onClick={() =>
                send({
                  type: "toast",
                  variant: "success",
                  message: "DevTools test notification",
                })
              }
            />
            <ActionButton
              label="Toast Warn"
              onClick={() =>
                send({
                  type: "toast",
                  variant: "warning",
                  message: "DevTools warning notification",
                })
              }
            />
            <ActionButton
              label="Toast Err"
              onClick={() =>
                send({
                  type: "toast",
                  variant: "error",
                  message: "DevTools error notification",
                })
              }
            />
          </div>
        </Section>

        {/* Crash Testing */}
        <Section title="Crash Testing">
          <div className="flex flex-wrap gap-1.5">
            <ActionButton
              label="Render Crash"
              tone="danger"
              onClick={() => send({ type: "crash-render" })}
            />
            <ActionButton
              label="JS Error"
              tone="danger"
              onClick={() => send({ type: "crash-runtime" })}
            />
            <ActionButton
              label="Promise Reject"
              onClick={() => send({ type: "crash-promise" })}
            />
            <ActionButton
              label="API 502"
              onClick={() => send({ type: "crash-api" })}
            />
          </div>
        </Section>

        {/* Crash Logs */}
        <Section
          title={`Crash Log (${snapshot?.crashes.length ?? 0})`}
          right={
            (snapshot?.crashes.length ?? 0) > 0 ? (
              <button
                type="button"
                onClick={() => send({ type: "clear-crashes" })}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-zinc-200 cursor-pointer"
              >
                <Trash2 size={11} />
                Clear
              </button>
            ) : null
          }
        >
          {snapshot && snapshot.crashes.length > 0 ? (
            <div className="flex max-h-44 flex-col divide-y divide-white/6 overflow-y-auto rounded-lg border border-white/8 bg-white/3">
              {snapshot.crashes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]"
                >
                  <div className="min-w-0 flex-1">
                    <span className="mr-1.5 font-mono text-[10px] text-zinc-500">
                      [{c.kind}]
                    </span>
                    <span className="truncate text-zinc-200" title={c.message}>
                      {c.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCrash(c.id, c.report)}
                    title="Copy crash report"
                    className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-white/8 hover:text-zinc-100 cursor-pointer"
                  >
                    {copiedId === c.id ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">No crashes recorded.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
export default DevToolsWindow;
