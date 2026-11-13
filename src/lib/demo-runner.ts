import { create } from "zustand";
import { toast } from "sonner";
import { useAppStore } from "../stores/app-store";
import { useNetworkStore } from "../stores/network-store";
import type { ActivityEvent, ChatMessage } from "../types";

export interface DemoHudState {
  active: boolean;
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  progress: number;
}

export const useDemoStore = create<DemoHudState>(() => ({
  active: false,
  step: 0,
  totalSteps: 9,
  title: "",
  subtitle: "",
  progress: 0,
}));

const RANDOM_USERS = [
  { login: "kuro_gg", displayName: "KuroGG", color: "#a78bfa" },
  { login: "lena_plays", displayName: "LenaPlays", color: "#34d399" },
  { login: "mika_fps", displayName: "MikaFPS", color: "#38bdf8" },
  { login: "nova_tv", displayName: "Nova_TV", color: "#f472b6" },
  { login: "tobi_craft", displayName: "TobiCraft", color: "#fbbf24" },
  { login: "sora_wave", displayName: "SoraWave", color: "#60a5fa" },
  { login: "vexi_live", displayName: "VexiLive", color: "#c084fc" },
  { login: "milo_byte", displayName: "MiloByte", color: "#4ade80" },
];

let abortController: AbortController | null = null;

function pickUser(index?: number) {
  return RANDOM_USERS[
    index !== undefined
      ? index % RANDOM_USERS.length
      : Math.floor(Math.random() * RANDOM_USERS.length)
  ];
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function makeEvent(
  partial: Omit<ActivityEvent, "id" | "timestamp" | "metadata"> & {
    metadata?: Record<string, unknown>;
  },
): ActivityEvent {
  return {
    id: `demo-evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    metadata: { demo: true, ...(partial.metadata ?? {}) },
    ...partial,
  };
}

function makeChat(user: (typeof RANDOM_USERS)[number], text: string): ChatMessage {
  return {
    id: `demo-chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    login: user.login,
    displayName: user.displayName,
    color: user.color,
    badges: [],
    timestamp: Date.now(),
    text,
    parts: [{ type: "text", text }],
  };
}

function scrollMainSmooth(top: number) {
  const main = document.querySelector(".app-main");
  if (main) {
    main.scrollTo({ top, behavior: "smooth" });
  }
}

async function notifyBridge(path: "/ready" | "/done") {
  try {
    await fetch(`http://127.0.0.1:1429${path}`, {
      method: "POST",
      mode: "no-cors",
    });
  } catch {
    // Recording server not running (manual OBS mode)
  }
}

export function stopDemoTour(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  useDemoStore.setState({
    active: false,
    step: 0,
    title: "",
    subtitle: "",
    progress: 0,
  });
}

export async function startDemoTour(options?: {
  autoSignal?: boolean;
}): Promise<void> {
  stopDemoTour();
  const controller = new AbortController();
  abortController = controller;
  const { signal } = controller;

  const setStep = (step: number, title: string, subtitle: string) => {
    useDemoStore.setState({
      active: true,
      step,
      totalSteps: 9,
      title,
      subtitle,
      progress: Math.round((step / 9) * 100),
    });
  };

  try {
    useNetworkStore.setState({ online: true, checking: false });
    const app = useAppStore.getState();

    // Prepare clean, rich showcase state in memory
    app.setEntitlements({
      tier: "pro",
      pro: true,
      twitchLogin: "tenkayro",
      features: ["cloud_sync", "pro_themes", "unlimited_profiles"],
    });
    app.setTwitch({ phase: "connected", account: "tenkayro", userId: "1001" });
    app.setTwitchBot({
      phase: "connected",
      account: "streamdash_bot",
      userId: "1002",
    });
    app.setObs({ phase: "connected", detail: "OBS 31.0 · WebSocket 5" });
    app.setStreamElements({ phase: "connected" });
    app.setTipeeeStream({ phase: "connected" });
    app.setObsSnapshot({
      version: "31.0.2",
      profile: "StreamDash 1080p60",
      sceneCollection: "Main Setup",
      scene: "Just Chatting",
      scenes: ["Starting Soon", "Just Chatting", "Gameplay", "BRB"],
      streaming: true,
      streamSeconds: 2840,
      streamBitrate: 6000,
      streamDropped: 0,
      recording: false,
      recordingPaused: false,
      recordingSeconds: 0,
      replayBuffer: true,
      virtualCam: false,
      fps: 60,
      cpu: 3.8,
      audio: [
        { name: "Mic / Aux", kind: "mic", muted: false, volume: 0.92, volumeDb: -1.4 },
        { name: "Desktop Audio", kind: "desktop", muted: false, volume: 0.78, volumeDb: -4.2 },
      ],
      updatedAt: Date.now(),
    });
    app.setStats({
      live: true,
      viewers: 142,
      followers: 2480,
      subscribers: 84,
      bits: 4250,
      donations: 65,
      donationCurrency: "EUR",
      startedAt: new Date(Date.now() - 47 * 60 * 1000).toISOString(),
      title: "StreamDash 2.1 Showcase · Live Control & Alerts",
      category: "Software and Game Development",
    });
    app.setEvents([]);
    app.setChatMessages([]);
    app.setPage("dashboard");

    if (options?.autoSignal) {
      await sleep(1100, signal);
      await notifyBridge("/ready");
      await sleep(600, signal);
    }

    // 1. Dashboard & Live Metrics
    setStep(1, "Live Dashboard", "Real-time stream metrics, alerts & OBS status");
    await sleep(900, signal);

    const u1 = pickUser(0);
    app.pushEvent(
      makeEvent({
        source: "twitch",
        eventType: "follow",
        username: u1.login,
        displayName: u1.displayName,
      }),
    );
    app.setStats({ viewers: 196, followers: 2481 });
    await sleep(850, signal);

    const u2 = pickUser(1);
    app.pushEvent(
      makeEvent({
        source: "streamelements",
        eventType: "donation",
        username: u2.login,
        displayName: u2.displayName,
        amount: 25,
        currency: "EUR",
        message: "Love the clean StreamDash UI!",
      }),
    );
    app.setStats({ viewers: 268, donations: 90 });
    toast.success(`${u2.displayName} donated 25,00 €!`);
    await sleep(950, signal);

    const u3 = pickUser(2);
    app.pushEvent(
      makeEvent({
        source: "twitch",
        eventType: "subscription",
        username: u3.login,
        displayName: u3.displayName,
        tier: "3000",
        message: "Tier 3 hype!",
      }),
    );
    app.setStats({ viewers: 342, subscribers: 85 });
    await sleep(950, signal);

    const u4 = pickUser(3);
    app.pushEvent(
      makeEvent({
        source: "twitch",
        eventType: "subscription",
        username: u4.login,
        displayName: u4.displayName,
        tier: "1000",
        metadata: { isPrime: true },
      }),
    );
    app.setStats({ viewers: 418, subscribers: 86 });
    await sleep(1200, signal);

    // 2. Activitys & Monetized Support Highlights
    setStep(2, "Activitys & Support", "Donations, Prime, Tier 1–3 subs & bits at a glance");
    app.setPage("activitys");
    await sleep(800, signal);
    app.pushEvent(
      makeEvent({
        source: "twitch",
        eventType: "cheer",
        username: pickUser(4).login,
        displayName: pickUser(4).displayName,
        bits: 1500,
        message: "1500 bits for the stream!",
      }),
    );
    app.setStats({ bits: 5750 });
    await sleep(850, signal);
    app.pushEvent(
      makeEvent({
        source: "twitch",
        eventType: "community_gift",
        username: pickUser(5).login,
        displayName: pickUser(5).displayName,
        tier: "2000",
        giftCount: 5,
      }),
    );
    await sleep(950, signal);
    app.pushEvent(
      makeEvent({
        source: "tipeeestream",
        eventType: "donation",
        username: pickUser(6).login,
        displayName: pickUser(6).displayName,
        amount: 10,
        currency: "EUR",
        message: "Keep up the awesome updates!",
      }),
    );
    app.setStats({ donations: 100 });
    await sleep(1500, signal);

    // 3. Live Chat & Commands
    setStep(3, "Live Chat", "Fast moderation, badges & instant replies");
    app.setPage("chat");
    const chatSamples: Array<[number, string]> = [
      [0, "Yo! The new dashboard looks super clean!"],
      [1, "!song"],
      [2, "Congrats on the Tier 3 sub!"],
      [3, "StreamDash running at 60fps smooth!"],
      [4, "!socials"],
    ];
    for (const [idx, text] of chatSamples) {
      const sender = pickUser(idx);
      const msg = makeChat(sender, text);
      app.pushChatMessage(msg);
      await sleep(620, signal);
    }
    await sleep(800, signal);

    // 4. Commands & Chat Alerts
    setStep(4, "Commands & Chat Alerts", "Custom variables, donations & tier-specific alerts");
    app.setPage("commands");
    await sleep(1900, signal);
    app.setPage("alerts");
    await sleep(2200, signal);

    // 5. Giveaways
    setStep(5, "Giveaways", "Live keyword entry tracking & instant winner draw");
    app.setPage("giveaways");
    app.setGiveaway({
      running: true,
      keyword: "!win",
      entries: [],
      winner: undefined,
    });
    await sleep(700, signal);
    for (let i = 0; i < 6; i++) {
      const entrant = pickUser(i);
      const msg = makeChat(entrant, "!win");
      app.pushChatMessage(msg);
      app.ingestGiveawayChatMessage(msg, "streamdash_bot");
      await sleep(340, signal);
    }
    const entries = useAppStore.getState().giveaway.entries;
    if (entries.length > 0) {
      const winner = entries[Math.floor(Math.random() * entries.length)];
      app.setGiveaway({ running: false, winner });
      toast.success(`Giveaway winner: ${winner.displayName}!`);
    }
    await sleep(1700, signal);

    // 6. OBS Control
    setStep(6, "OBS Studio Control", "Switch scenes, audio mixers & replay buffer");
    app.setPage("obs");
    await sleep(1100, signal);
    const obsSnap = useAppStore.getState().obsSnapshot;
    if (obsSnap) {
      app.setObsSnapshot({
        ...obsSnap,
        scene: "Gameplay",
        updatedAt: Date.now(),
      });
      toast.info("OBS Scene switched to Gameplay");
    }
    await sleep(1900, signal);

    // 7. Statistics & Goals
    setStep(7, "Statistics & Goals", "Track growth, revenue & community milestones");
    app.setPage("statistics");
    await sleep(2000, signal);
    app.setPage("goals");
    await sleep(2000, signal);

    // 8. Connections & Pro Cloud Sync
    setStep(8, "Connections & Pro Cloud", "Unified services & encrypted cross-device sync");
    app.setPage("connections");
    await sleep(1900, signal);
    app.setPage("settings");
    await sleep(900, signal);
    scrollMainSmooth(240);
    await sleep(1500, signal);
    scrollMainSmooth(0);

    // 9. Finale back on Dashboard
    setStep(9, "StreamDash 2.1", "Built for streamers. Fast, local & reliable.");
    app.setPage("dashboard");
    await sleep(2600, signal);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  } finally {
    if (abortController === controller) {
      abortController = null;
    }
    useDemoStore.setState({
      active: false,
      step: 0,
      title: "",
      subtitle: "",
      progress: 0,
    });
    if (options?.autoSignal) {
      await notifyBridge("/done");
    }
  }
}
