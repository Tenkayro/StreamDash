import { create } from "zustand";
import { toast } from "sonner";
import {
  defaultChatAlerts,
  defaultCommands,
  defaultCustomVariables,
} from "./defaults";
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

async function notifyBridge(path: "/ready" | "/done", payload?: unknown) {
  try {
    await fetch(`http://127.0.0.1:1429${path}`, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch {
    // Recording server not running (manual OBS mode)
  }
}

function getWindowCaptureRect() {
  const dpr = window.devicePixelRatio || 1;
  const x = Math.max(0, Math.round(window.screenX * dpr));
  const y = Math.max(0, Math.round(window.screenY * dpr));
  const width = Math.max(320, Math.round(window.outerWidth * dpr));
  const height = Math.max(240, Math.round(window.outerHeight * dpr));
  return { x, y, width, height };
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
      totalSteps: 10,
      title,
      subtitle,
      progress: Math.round((step / 10) * 100),
    });
  };

  try {
    useNetworkStore.setState({ online: true, checking: false });
    const app = useAppStore.getState();

    // Populate a complete, isolated fake save state in memory
    app.setSettings({
      onboardingCompleted: false,
      goals: {
        ...app.settings.goals,
        followers: 3000,
        subscribers: 100,
        donations: 150,
      },
    });
    app.setEntitlements({
      tier: "pro",
      pro: true,
      twitchLogin: "tenkayro",
      features: ["cloud_sync", "pro_themes", "unlimited_profiles"],
    });
    app.setCloudSyncEnabled(true);
    app.setCloudSync({
      phase: "synced",
      lastSyncedAt: Date.now(),
      hasLocalChanges: false,
      error: undefined,
      historyError: undefined,
      storageInfo: {
        usedBytes: 2_140_000,
        quotaBytes: 26_214_400,
        defaultQuotaBytes: 26_214_400,
        effectiveDefaultQuotaBytes: 26_214_400,
        globalUsedBytes: 180_000_000,
        globalPoolMaxBytes: 1_073_741_824,
        globalSoftThrottled: false,
        globalPoolFull: false,
        historyRevision: 12,
        historyUpdatedAt: Date.now(),
        historyEventCount: 142,
      },
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
    app.setCommands(
      defaultCommands.map((cmd, idx) => ({
        ...cmd,
        enabled: true,
        usageCount: 40 + idx * 37,
      })),
    );
    app.setCustomVariables(
      defaultCustomVariables.map((v, idx) => ({
        ...v,
        value: String(3 + idx * 4),
        updatedAt: Date.now(),
      })),
    );
    app.setChannelRewards([
      {
        id: "demo-rew-1",
        title: "Hydrate!",
        cost: 250,
        enabled: true,
        paused: false,
        prompt: "Remind streamer to drink water",
        backgroundColor: "#0ea5e9",
        enabledWhenOffline: false,
        enabledWhenOnline: true,
        userInputRequired: false,
        skipRequestQueue: true,
        maxPerStreamEnabled: false,
        maxPerStream: 0,
        maxPerUserPerStreamEnabled: false,
        maxPerUserPerStream: 0,
        globalCooldownEnabled: true,
        globalCooldownSeconds: 120,
      },
      {
        id: "demo-rew-2",
        title: "Stretch Break",
        cost: 500,
        enabled: true,
        paused: false,
        prompt: "Quick posture & stretch check",
        backgroundColor: "#10b981",
        enabledWhenOffline: false,
        enabledWhenOnline: true,
        userInputRequired: false,
        skipRequestQueue: false,
        maxPerStreamEnabled: false,
        maxPerStream: 0,
        maxPerUserPerStreamEnabled: false,
        maxPerUserPerStream: 0,
        globalCooldownEnabled: true,
        globalCooldownSeconds: 300,
      },
      {
        id: "demo-rew-3",
        title: "Pick Next Game",
        cost: 2500,
        enabled: true,
        paused: false,
        prompt: "Choose the next game on stream",
        backgroundColor: "#8b5cf6",
        enabledWhenOffline: false,
        enabledWhenOnline: true,
        userInputRequired: true,
        skipRequestQueue: false,
        maxPerStreamEnabled: true,
        maxPerStream: 2,
        maxPerUserPerStreamEnabled: true,
        maxPerUserPerStream: 1,
        globalCooldownEnabled: true,
        globalCooldownSeconds: 900,
      },
    ]);
    app.setChatAlerts({
      ...defaultChatAlerts,
      donation: { ...defaultChatAlerts.donation, enabled: true },
      subTier1: { ...defaultChatAlerts.subTier1, enabled: true },
      subPrime: { ...defaultChatAlerts.subPrime, enabled: true },
      resubTier1: { ...defaultChatAlerts.resubTier1, enabled: true },
      giftTier1: { ...defaultChatAlerts.giftTier1, enabled: true },
      raid: { ...defaultChatAlerts.raid, enabled: true },
      bits: { ...defaultChatAlerts.bits, enabled: true },
      follower: { ...defaultChatAlerts.follower, enabled: true },
      goLive: { ...defaultChatAlerts.goLive, enabled: true },
    });
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

    if (options?.autoSignal) {
      await sleep(1000, signal);
      await notifyBridge("/ready", getWindowCaptureRect());
      await sleep(700, signal);
    }

    // 1. Setup Wizard
    setStep(1, "Quick Setup", "Connect Twitch, OBS & services in seconds");
    await sleep(2300, signal);
    app.setSettings({ onboardingCompleted: true });
    app.setPage("dashboard");
    await sleep(600, signal);

    // 2. Dashboard & Live Metrics
    setStep(2, "Live Dashboard", "Real-time stream metrics, alerts & OBS status");
    await sleep(700, signal);

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

    // 3. Activitys & Monetized Support Highlights
    setStep(3, "Activitys & Support", "Donations, Prime, Tier 1–3 subs & bits at a glance");
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

    // 4. Live Chat & Commands
    setStep(4, "Live Chat", "Fast moderation, badges & instant replies");
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

    // 5. Commands & Chat Alerts
    setStep(5, "Commands & Chat Alerts", "Custom variables, donations & tier-specific alerts");
    app.setPage("commands");
    await sleep(1900, signal);
    app.setPage("alerts");
    await sleep(2200, signal);

    // 6. Giveaways
    setStep(6, "Giveaways", "Live keyword entry tracking & instant winner draw");
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

    // 7. OBS Control
    setStep(7, "OBS Studio Control", "Switch scenes, audio mixers & replay buffer");
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

    // 8. Statistics & Goals
    setStep(8, "Statistics & Goals", "Track growth, revenue & community milestones");
    app.setPage("statistics");
    await sleep(2000, signal);
    app.setPage("goals");
    await sleep(2000, signal);

    // 9. Connections & Pro Cloud Sync
    setStep(9, "Connections & Pro Cloud", "Unified services & encrypted cross-device sync");
    app.setPage("connections");
    await sleep(1900, signal);
    app.setPage("settings");
    await sleep(900, signal);
    scrollMainSmooth(240);
    await sleep(1500, signal);
    scrollMainSmooth(0);

    // 10. Finale back on Dashboard
    setStep(10, "StreamDash 2.1", "Built for streamers. Fast, local & reliable.");
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
