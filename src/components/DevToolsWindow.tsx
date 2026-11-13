import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
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

type DevTab = "sim" | "env" | "crash";

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
  const [tab, setTab] = useState<DevTab>("sim");
  const [chatText, setChatText] = useState("Hello from DevTools!");
  const [chatUser, setChatUser] = useState("DevViewer");
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

  const cyclePhase = (
    target: "twitch" | "twitchBot" | "obs" | "streamElements" | "tipeeStream",
    current: string,
  ) => {
    const next =
      current === "connected"
        ? "error"
        : current === "error"
          ? "disconnected"
          : "connected";
    send({ type: "set-connection", target, phase: next });
  };

  return (
    <div className="min-h-screen bg-[#0c0e14] p-4 text-zinc-100 select-none">
      <div className="mx-auto flex max-w-lg flex-col gap-3">
        {/* Minimal Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                snapshot ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <h1 className="text-sm font-semibold text-white">DevTools</h1>
            <span className="text-[11px] text-zinc-500">
              {snapshot ? `/${snapshot.page}` : "connecting…"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ActionButton
              label={snapshot?.demoActive ? "Stop Demo" : "Demo Tour"}
              tone={snapshot?.demoActive ? "danger" : "accent"}
              onClick={() =>
                send({ type: snapshot?.demoActive ? "stop-demo" : "start-demo" })
              }
            />
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
              Live:{" "}
              <strong
                className={
                  snapshot.stats.live ? "text-emerald-400" : "text-zinc-300"
                }
              >
                {snapshot.stats.live ? `${snapshot.stats.viewers}v` : "off"}
              </strong>
            </span>
            <span>
              Events:{" "}
              <strong className="text-zinc-200">
                {snapshot.stats.eventCount}
              </strong>
            </span>
          </div>
        )}

        {/* Minimal Tabs */}
        <div className="flex gap-1 rounded-lg border border-white/8 bg-white/3 p-1">
          {(
            [
              ["sim", "Simulate"],
              ["env", "Environment"],
              ["crash", `Crashes (${snapshot?.crashes.length ?? 0})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 rounded-md py-1 text-[11px] font-medium transition cursor-pointer ${
                tab === id
                  ? "bg-white/10 text-white"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "sim" && (
          <>
            <Section title="Events &amp; Donations">
              <div className="flex flex-wrap gap-1.5">
                <ActionButton
                  label="+Follow"
                  onClick={() =>
                    send({ type: "simulate-event", eventType: "follow" })
                  }
                />
                <ActionButton
                  label="+Sub T1"
                  onClick={() =>
                    send({ type: "simulate-event", eventType: "subscription" })
                  }
                />
                <ActionButton
                  label="+Sub Prime"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "subscription_prime",
                    })
                  }
                />
                <ActionButton
                  label="+Sub T2"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "subscription_tier2",
                    })
                  }
                />
                <ActionButton
                  label="+Sub T3"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "subscription_tier3",
                    })
                  }
                />
                <ActionButton
                  label="+Resub"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "resubscription",
                    })
                  }
                />
                <ActionButton
                  label="+Gift Sub"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "gift_subscription",
                    })
                  }
                />
                <ActionButton
                  label="+5 Gift Subs"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "community_gift",
                    })
                  }
                />
                <ActionButton
                  label="+500 Bits"
                  onClick={() =>
                    send({ type: "simulate-event", eventType: "cheer" })
                  }
                />
                <ActionButton
                  label="+Raid (42)"
                  onClick={() =>
                    send({ type: "simulate-event", eventType: "raid" })
                  }
                />
                <ActionButton
                  label="+Spende SE (10€)"
                  tone="accent"
                  onClick={() =>
                    send({ type: "simulate-event", eventType: "donation_se" })
                  }
                />
                <ActionButton
                  label="+Spende Tipeee (5€)"
                  tone="accent"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "donation_tipeee",
                    })
                  }
                />
                <ActionButton
                  label="+Channel Point"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "channel_point",
                    })
                  }
                />
                <ActionButton
                  label="Stream Online"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "stream_online",
                    })
                  }
                />
                <ActionButton
                  label="Stream Offline"
                  onClick={() =>
                    send({
                      type: "simulate-event",
                      eventType: "stream_offline",
                    })
                  }
                />
              </div>
            </Section>

            <Section title="Chat &amp; Giveaway">
              <div className="mb-2 flex gap-1.5">
                <input
                  type="text"
                  value={chatUser}
                  onChange={(e) => setChatUser(e.target.value)}
                  placeholder="User"
                  className="h-7 w-28 rounded-md border border-white/10 bg-[#141722] px-2 text-[11px] text-zinc-100 outline-none"
                />
                <input
                  type="text"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="Message or !command"
                  className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-[#141722] px-2 text-[11px] text-zinc-100 outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ActionButton
                  label="Send Chat"
                  onClick={() =>
                    send({
                      type: "simulate-chat",
                      text: chatText,
                      username: chatUser,
                    })
                  }
                />
                <ActionButton
                  label="+Giveaway Entry"
                  onClick={() => send({ type: "simulate-giveaway-entry" })}
                />
              </div>
            </Section>

            <Section title="Stream Stats &amp; Toasts">
              <div className="flex flex-wrap gap-1.5">
                <ActionButton
                  label={snapshot?.stats.live ? "Live: ON" : "Live: OFF"}
                  active={Boolean(snapshot?.stats.live)}
                  onClick={() => send({ type: "toggle-live" })}
                />
                <ActionButton
                  label="+25 Viewers"
                  onClick={() => send({ type: "bump-stats", viewers: 25 })}
                />
                <ActionButton
                  label="+1 Follower"
                  onClick={() => send({ type: "bump-stats", followers: 1 })}
                />
                <ActionButton
                  label="Toast OK"
                  onClick={() =>
                    send({
                      type: "toast",
                      variant: "success",
                      message: "StreamDash test success",
                    })
                  }
                />
                <ActionButton
                  label="Toast Info"
                  onClick={() =>
                    send({
                      type: "toast",
                      variant: "info",
                      message: "StreamDash test info",
                    })
                  }
                />
                <ActionButton
                  label="Toast Warn"
                  onClick={() =>
                    send({
                      type: "toast",
                      variant: "warning",
                      message: "StreamDash test warning",
                    })
                  }
                />
                <ActionButton
                  label="Toast Err"
                  onClick={() =>
                    send({
                      type: "toast",
                      variant: "error",
                      message: "StreamDash test error",
                    })
                  }
                />
              </div>
            </Section>
          </>
        )}

        {tab === "env" && (
          <>
            <Section title="App &amp; Network">
              <div className="flex flex-wrap items-center gap-1.5">
                <ActionButton
                  label={
                    snapshot?.online === false ? "Offline (ON)" : "Offline"
                  }
                  tone={snapshot?.online === false ? "danger" : "default"}
                  onClick={() =>
                    send({
                      type: "set-online",
                      online: snapshot?.online === false,
                    })
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

            <Section title="Mock Connections (Click to cycle)">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["twitch", "Twitch", snapshot?.connections.twitch.phase],
                    [
                      "twitchBot",
                      "Bot",
                      snapshot?.connections.twitchBot.phase,
                    ],
                    ["obs", "OBS", snapshot?.connections.obs.phase],
                    [
                      "streamElements",
                      "SE",
                      snapshot?.connections.streamElements.phase,
                    ],
                    [
                      "tipeeStream",
                      "Tipeee",
                      snapshot?.connections.tipeeStream.phase,
                    ],
                  ] as const
                ).map(([key, label, phase]) => (
                  <ActionButton
                    key={key}
                    label={`${label}: ${phase ?? "?"}`}
                    active={phase === "connected"}
                    tone={phase === "error" ? "danger" : "default"}
                    onClick={() => cyclePhase(key, phase ?? "disconnected")}
                  />
                ))}
              </div>
            </Section>
          </>
        )}

        {tab === "crash" && (
          <>
            <Section title="Trigger Error / Crash">
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
                <div className="flex max-h-60 flex-col divide-y divide-white/6 overflow-y-auto rounded-lg border border-white/8 bg-white/3">
                  {snapshot.crashes.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="mr-1.5 font-mono text-[10px] text-zinc-500">
                          [{c.kind}]
                        </span>
                        <span
                          className="truncate text-zinc-200"
                          title={c.message}
                        >
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
                <p className="text-[11px] text-zinc-500">
                  No crashes recorded.
                </p>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
export default DevToolsWindow;
