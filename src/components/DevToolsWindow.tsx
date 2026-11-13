import {
  Activity,
  AlertOctagon,
  Bell,
  Bug,
  Check,
  Compass,
  Copy,
  Crown,
  Globe,
  MessageSquare,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui";
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

function StatusPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "neutral" | "accent";
}) {
  const toneClass =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : tone === "bad"
        ? "border-red-500/35 bg-red-500/10 text-red-300"
        : tone === "warn"
          ? "border-amber-500/35 bg-amber-500/10 text-amber-300"
          : tone === "accent"
            ? "border-violet-500/35 bg-violet-500/10 text-violet-300"
            : "border-white/10 bg-white/[0.04] text-zinc-300";

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${toneClass}`}
    >
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

export function DevToolsWindow() {
  const [snapshot, setSnapshot] = useState<DevStateSnapshot | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customToast, setCustomToast] = useState("DevTools test notification");
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

  const connectionEntries = useMemo(() => {
    if (!snapshot) return [];
    return [
      { name: "Twitch", phase: snapshot.connections.twitch.phase },
      { name: "Bot", phase: snapshot.connections.twitchBot.phase },
      { name: "OBS", phase: snapshot.connections.obs.phase },
      { name: "StreamElements", phase: snapshot.connections.streamElements.phase },
      { name: "TipeeeStream", phase: snapshot.connections.tipeeStream.phase },
    ];
  }, [snapshot]);

  const copyCrash = async (id: string, report: string) => {
    try {
      await navigator.clipboard.writeText(report);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore clipboard failure in restricted context
    }
  };

  return (
    <div className="min-h-screen bg-[#0c0e14] p-4 text-zinc-100 select-none">
      <div className="mx-auto flex max-w-2xl flex-col gap-3.5">
        <header className="flex items-center justify-between rounded-xl border border-violet-500/25 bg-violet-500/[0.07] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <Bug size={16} />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-white">
                StreamDash DevTools
              </h1>
              <p className="text-[11px] text-zinc-400">
                Dev-only debugging &amp; crash testing ({snapshot ? "Connected" : "Waiting for main window…"})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "request-state" })}
              title="Refresh state snapshot"
            >
              <RefreshCw size={12} />
            </Button>
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "reload" })}
              title="Reload main window"
            >
              Reload App
            </Button>
          </div>
        </header>

        {/* Crash & Error Testing */}
        <section className="rounded-xl border border-red-500/25 bg-red-500/4 p-3">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
              <AlertOctagon size={14} />
              <span>Crash &amp; Error Testing</span>
            </div>
            <span className="text-[10px] text-zinc-400">
              Tests CrashBoundary &amp; CrashDialog
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="danger"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "crash-render" })}
            >
              <Zap size={12} />
              React Render Crash
            </Button>
            <Button
              variant="danger"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "crash-runtime" })}
            >
              <AlertOctagon size={12} />
              Uncaught JS Error
            </Button>
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "crash-promise" })}
            >
              Unhandled Promise
            </Button>
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "crash-api" })}
            >
              Simulated API Error (502)
            </Button>
          </div>
        </section>

        {/* Network & Pro */}
        <div className="grid grid-cols-2 gap-3">
          <section className="rounded-xl border border-white/10 bg-white/3 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              {snapshot?.online === false ? (
                <WifiOff size={13} className="text-red-400" />
              ) : (
                <Wifi size={13} className="text-emerald-400" />
              )}
              <span>Network Simulator</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant={snapshot?.online === false ? "danger" : "default"}
                className="h-7 px-2.5 text-xs"
                onClick={() => send({ type: "set-online", online: false })}
              >
                Force Offline
              </Button>
              <Button
                variant={snapshot?.online !== false ? "primary" : "default"}
                className="h-7 px-2.5 text-xs"
                onClick={() => send({ type: "set-online", online: true })}
              >
                Force Online
              </Button>
              <Button
                variant="default"
                className="h-7 px-2.5 text-xs"
                onClick={() => send({ type: "check-network" })}
              >
                Probe Now
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-white/3 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Crown size={13} className="text-amber-400" />
              <span>Pro &amp; Locale</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant={snapshot?.pro ? "primary" : "default"}
                className="h-7 px-2.5 text-xs"
                onClick={() => send({ type: "set-pro", pro: !snapshot?.pro })}
              >
                {snapshot?.pro ? "Pro: ON (Toggle)" : "Pro: OFF (Toggle)"}
              </Button>
              <select
                aria-label="Interface language"
                className="rounded-lg border border-white/10 bg-[#151822] px-2 py-1 text-xs text-zinc-100 outline-none"
                value={snapshot?.language ?? "en"}
                onChange={(e) =>
                  send({
                    type: "set-language",
                    language: e.target.value as (typeof LANGUAGES)[number],
                  })
                }
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>

        {/* Event & Toast Simulation */}
        <section className="rounded-xl border border-white/10 bg-white/3 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <Activity size={13} className="text-sky-400" />
            <span>Mock Events, Chat &amp; Toasts</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(["follow", "subscription", "raid", "cheer", "donation"] as const).map(
              (evt) => (
                <Button
                  key={evt}
                  variant="default"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => send({ type: "simulate-event", eventType: evt })}
                >
                  +{evt}
                </Button>
              ),
            )}
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() => send({ type: "simulate-chat" })}
            >
              <MessageSquare size={11} />
              +Chat Msg
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Bell size={12} className="shrink-0 text-zinc-400" />
            <input
              type="text"
              value={customToast}
              onChange={(e) => setCustomToast(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#151822] px-2.5 py-1 text-xs text-zinc-100 outline-none"
              placeholder="Toast message..."
            />
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() =>
                send({ type: "toast", variant: "success", message: customToast })
              }
            >
              Success
            </Button>
            <Button
              variant="default"
              className="h-7 px-2.5 text-xs"
              onClick={() =>
                send({ type: "toast", variant: "error", message: customToast })
              }
            >
              Error
            </Button>
          </div>
        </section>

        {/* Quick Navigation */}
        <section className="rounded-xl border border-white/10 bg-white/3 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <Compass size={13} className="text-violet-400" />
            <span>Quick Page Jump</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PAGES.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => send({ type: "navigate", page })}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  snapshot?.page === page
                    ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
                    : "border-white/10 bg-white/3 text-zinc-300 hover:bg-white/8"
                }`}
              >
                {page}
              </button>
            ))}
          </div>
        </section>

        {/* Live Inspector */}
        <section className="rounded-xl border border-white/10 bg-white/3 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <Globe size={13} className="text-emerald-400" />
            <span>Live State Inspector</span>
          </div>
          {snapshot ? (
            <div className="grid grid-cols-2 gap-1.5">
              <StatusPill
                label="Network"
                value={snapshot.online ? "Online" : "Offline"}
                tone={snapshot.online ? "ok" : "bad"}
              />
              <StatusPill
                label="Page"
                value={snapshot.page}
                tone="accent"
              />
              <StatusPill
                label="Pro Tier"
                value={snapshot.pro ? "PRO" : "FREE"}
                tone={snapshot.pro ? "ok" : "neutral"}
              />
              <StatusPill
                label="Cloud Sync"
                value={
                  snapshot.cloudSyncEnabled ? snapshot.cloudSyncPhase : "disabled"
                }
              />
              {connectionEntries.map((c) => (
                <StatusPill
                  key={c.name}
                  label={c.name}
                  value={c.phase}
                  tone={
                    c.phase === "connected"
                      ? "ok"
                      : c.phase === "error" || c.phase === "expired"
                        ? "bad"
                        : "neutral"
                  }
                />
              ))}
              <StatusPill
                label="Chat / Events"
                value={`${snapshot.stats.chatCount} / ${snapshot.stats.eventCount}`}
              />
            </div>
          ) : (
            <p className="text-xs text-zinc-400">
              Waiting for snapshot from main StreamDash window…
            </p>
          )}
        </section>

        {/* Recent Crash Logs */}
        <section className="rounded-xl border border-white/10 bg-white/3 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-200">
              Recent Crash Logs ({snapshot?.crashes.length ?? 0})
            </span>
            {(snapshot?.crashes.length ?? 0) > 0 && (
              <Button
                variant="default"
                className="h-7 px-2.5 text-xs"
                onClick={() => send({ type: "clear-crashes" })}
              >
                <Trash2 size={11} />
                Clear
              </Button>
            )}
          </div>
          {snapshot && snapshot.crashes.length > 0 ? (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
              {snapshot.crashes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-[#12151e] p-2 text-[11px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                      <span className="rounded bg-white/10 px-1 py-0.5 text-zinc-200">
                        {c.kind}
                      </span>
                      <span>{c.fatal ? "FATAL" : "NON-FATAL"}</span>
                      <span>· {c.timestamp.slice(11, 19)}</span>
                    </div>
                    <p className="mt-1 truncate text-zinc-200" title={c.message}>
                      {c.message}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyCrash(c.id, c.report)}
                    className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-white/10"
                    title="Copy full crash report"
                  >
                    {copiedId === c.id ? (
                      <Check size={11} className="text-emerald-400" />
                    ) : (
                      <Copy size={11} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No crashes recorded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
export default DevToolsWindow;
