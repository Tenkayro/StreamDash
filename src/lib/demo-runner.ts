import { create } from "zustand";
import { toast } from "sonner";
import i18n from "../i18n";
import {
  defaultChatAlerts,
  defaultCommands,
  defaultCustomVariables,
} from "./defaults";
import { useAppStore } from "../stores/app-store";
import { useNetworkStore } from "../stores/network-store";
import type { ActivityEvent, ChatCommand, ChatMessage } from "../types";

export interface ZoomSpan {
  startMs: number;
  endMs: number;
  scale: number;
  cx: number;
  cy: number;
}

export interface DemoHudState {
  active: boolean;
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  progress: number;
  cursor: {
    visible: boolean;
    x: number;
    y: number;
    clicking: boolean;
    rippleKey: number;
  };
}

const DEFAULT_CURSOR = {
  visible: false,
  x: 640,
  y: 400,
  clicking: false,
  rippleKey: 0,
};

export const useDemoStore = create<DemoHudState>(() => ({
  active: false,
  step: 0,
  totalSteps: 12,
  title: "",
  subtitle: "",
  progress: 0,
  cursor: DEFAULT_CURSOR,
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
let autoStarted = false;

export function startAutoDemoOnce(): void {
  if (autoStarted) return;
  autoStarted = true;
  void startDemoTour({ autoSignal: true });
}

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

async function moveCursorToPoint(
  x: number,
  y: number,
  signal: AbortSignal,
  click = false,
) {
  useDemoStore.setState((s) => ({
    cursor: {
      ...s.cursor,
      visible: true,
      x: Math.round(x),
      y: Math.round(y),
      clicking: false,
    },
  }));
  await sleep(490, signal);
  if (click) {
    useDemoStore.setState((s) => ({
      cursor: {
        ...s.cursor,
        clicking: true,
        rippleKey: s.cursor.rippleKey + 1,
      },
    }));
    await sleep(160, signal);
    useDemoStore.setState((s) => ({
      cursor: { ...s.cursor, clicking: false },
    }));
  }
}

async function clickElement(
  el: HTMLElement | null,
  signal: AbortSignal,
  actuallyClickDom = true,
) {
  if (!el) return false;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  await sleep(120, signal);
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  await moveCursorToPoint(
    rect.left + rect.width * 0.5,
    rect.top + rect.height * 0.5,
    signal,
    true,
  );
  if (actuallyClickDom) {
    el.click();
  }
  return true;
}

async function moveCursorToSelector(
  selector: string,
  signal: AbortSignal,
  click = true,
) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  await moveCursorToPoint(
    rect.left + rect.width * 0.52,
    rect.top + rect.height * 0.5,
    signal,
    click,
  );
}

async function navigateWithCursor(pageId: string, signal: AbortSignal) {
  const btn = document.querySelector<HTMLElement>(`[data-nav-id="${pageId}"]`);
  if (btn) {
    btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    await sleep(140, signal);
    await moveCursorToSelector(`[data-nav-id="${pageId}"]`, signal, true);
  }
  useAppStore.getState().setPage(pageId);
}

async function clickButtonByText(
  labels: string[],
  signal: AbortSignal,
  actuallyClickDom = true,
  rootSelector = ".app-main",
) {
  const root = document.querySelector<HTMLElement>(rootSelector) ?? document.body;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const lowered = labels.map((l) => l.toLowerCase());
  const target = buttons.find((btn) => {
    const rect = btn.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || btn.disabled) return false;
    const text = (btn.textContent ?? "").trim().toLowerCase();
    return lowered.some((label) => text.includes(label));
  });
  return clickElement(target ?? null, signal, actuallyClickDom);
}

async function clickSelector(
  selector: string,
  signal: AbortSignal,
  actuallyClickDom = true,
  rootSelector = ".app-main",
) {
  const root = document.querySelector<HTMLElement>(rootSelector) ?? document.body;
  const target = root.querySelector<HTMLElement>(selector);
  return clickElement(target, signal, actuallyClickDom);
}

async function typeIntoSelector(
  selector: string,
  text: string,
  signal: AbortSignal,
) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!input) return false;
  await clickElement(input, signal, true);
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  let current = "";
  for (const ch of text) {
    current += ch;
    setter?.call(input, current);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(32, signal);
  }
  return true;
}

function scrollMainSmooth(top: number) {
  const main = document.querySelector(".app-main");
  if (main) {
    main.scrollTo({ top, behavior: "smooth" });
  }
}

function getMainMaxScroll(): number {
  const main = document.querySelector(".app-main");
  if (!main) return 0;
  return Math.max(0, main.scrollHeight - main.clientHeight);
}

function createDemoCommands(): ChatCommand[] {
  const baseTemplate = defaultCommands[0];
  const makeCustom = (
    id: string,
    name: string,
    response: string,
    aliases: string[],
    usageCount: number,
    roles: ChatCommand["roles"] = [],
  ): ChatCommand => ({
    ...baseTemplate,
    id,
    name,
    builtIn: false,
    enabled: true,
    response,
    aliases,
    usageCount,
    roles,
    createdAt: Date.now() - usageCount * 60_000,
  });

  return [
    ...defaultCommands.map((cmd, idx) => ({
      ...cmd,
      enabled: true,
      usageCount: 142 + idx * 19,
    })),
    makeCustom(
      "demo-cmd-discord",
      "discord",
      "Join the community Discord: https://discord.gg/streamdash",
      ["dc"],
      124,
    ),
    makeCustom(
      "demo-cmd-socials",
      "socials",
      "Follow {channel} on X, YouTube & TikTok: https://links.streamdash.app",
      ["links", "youtube"],
      89,
    ),
    makeCustom(
      "demo-cmd-lurk",
      "lurk",
      "Thanks for the lurk, {user}! Grab a snack and enjoy the stream.",
      [],
      95,
    ),
    makeCustom(
      "demo-cmd-uptime",
      "uptime",
      "{channel} has been live for {uptime}!",
      [],
      67,
    ),
    makeCustom(
      "demo-cmd-setup",
      "setup",
      "Streaming with StreamDash 2.1 + OBS 31.0 at 1080p60!",
      ["specs", "pc"],
      51,
    ),
    makeCustom(
      "demo-cmd-so",
      "so",
      "Go check out {target} at https://twitch.tv/{target} — they were last playing {game}!",
      ["shoutout"],
      38,
      ["moderator"],
    ),
  ];
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
    cursor: DEFAULT_CURSOR,
  });
}

export async function startDemoTour(options?: {
  autoSignal?: boolean;
}): Promise<void> {
  stopDemoTour();
  const controller = new AbortController();
  abortController = controller;
  const { signal } = controller;

  const zoomSpans: ZoomSpan[] = [];
  let recordStartMs = performance.now();
  let activeZoom: { startMs: number; scale: number; cx: number; cy: number } | null =
    null;

  const beginZoom = (scale: number, cx: number, cy: number) => {
    if (activeZoom) {
      zoomSpans.push({ ...activeZoom, endMs: Math.round(performance.now() - recordStartMs) });
    }
    activeZoom = {
      startMs: Math.round(performance.now() - recordStartMs),
      scale,
      cx,
      cy,
    };
  };

  const endZoom = () => {
    if (!activeZoom) return;
    const endMs = Math.round(performance.now() - recordStartMs);
    if (endMs - activeZoom.startMs >= 900) {
      zoomSpans.push({ ...activeZoom, endMs });
    }
    activeZoom = null;
  };

  const setStep = (step: number, title: string, subtitle: string) => {
    const progress = Math.round((step / 12) * 100);
    useDemoStore.setState({
      active: true,
      step,
      totalSteps: 12,
      title,
      subtitle,
      progress,
    });
  };

  try {
    useNetworkStore.setState({ online: true, checking: false });
    const app = useAppStore.getState();

    // Populate a complete, isolated fake save state in memory (English UI)
    void i18n.changeLanguage("en");
    app.setSettings({
      language: "en",
      accentColor: "violet",
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
    app.setCommands(createDemoCommands());
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
      recordStartMs = performance.now();
      await notifyBridge("/ready", getWindowCaptureRect());
      await sleep(600, signal);
    }

    // 1. Setup Wizard
    setStep(1, "Quick Setup", "Connect Twitch, OBS & services in seconds");
    await sleep(650, signal);
    await clickButtonByText(["Violet"], signal, true, ".app-shell");
    await sleep(350, signal);
    await clickButtonByText(["Next", "Continue"], signal, false, ".app-shell");
    await sleep(300, signal);
    app.setSettings({ onboardingCompleted: true });
    app.setPage("dashboard");
    await sleep(550, signal);

    // 2. Dashboard & Live Metrics
    setStep(2, "Live Dashboard", "Real-time stream metrics, alerts & OBS status");
    beginZoom(1.24, 0.62, 0.28);

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
    await sleep(650, signal);

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
    await sleep(750, signal);

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
    await sleep(700, signal);

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
    await sleep(750, signal);
    endZoom();

    // 3. Stream & Live Preview
    setStep(3, "Stream & Live Preview", "Edit title, category & monitor your live feed");
    await navigateWithCursor("stream", signal);
    await typeIntoSelector(".app-main input", "StreamDash 2.1 Showcase · Live!", signal);
    await sleep(450, signal);
    await navigateWithCursor("livePreview", signal);
    await sleep(1050, signal);

    // 4. Activitys & Monetized Support Highlights
    setStep(4, "Activitys & Support", "Donations, Prime, Tier 1–3 subs & bits at a glance");
    await navigateWithCursor("activitys", signal);
    await sleep(300, signal);
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
    await sleep(550, signal);
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
    await sleep(550, signal);
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
    beginZoom(1.26, 0.56, 0.44);
    await clickButtonByText(["Donations"], signal, true);
    await sleep(650, signal);
    await clickButtonByText(["All"], signal, true);
    await sleep(450, signal);
    endZoom();

    // 5. Live Chat
    setStep(5, "Live Chat", "Fast moderation, badges & instant command replies");
    await navigateWithCursor("chat", signal);
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
      await sleep(380, signal);
    }
    beginZoom(1.24, 0.56, 0.78);
    await typeIntoSelector(
      ".app-main input[type='text'], .app-main input:not([type])",
      "Welcome everyone! Checking out StreamDash 2.1!",
      signal,
    );
    app.pushChatMessage(
      makeChat(
        { login: "tenkayro", displayName: "tenkayro", color: "#a78bfa" },
        "Welcome everyone! Checking out StreamDash 2.1!",
      ),
    );
    await sleep(500, signal);
    endZoom();

    // 6. Commands & Variables
    setStep(6, "Commands & Variables", "Custom chat commands, aliases & dynamic variables");
    await navigateWithCursor("commands", signal);
    beginZoom(1.25, 0.58, 0.44);
    await sleep(450, signal);
    await clickSelector('button[aria-label="Edit"]', signal, true);
    await sleep(1100, signal);
    await clickButtonByText(["Cancel"], signal, true, "body");
    await sleep(350, signal);
    endZoom();
    await navigateWithCursor("variables", signal);
    await sleep(950, signal);

    // 7. Chat Alerts & Channel Points
    setStep(7, "Chat Alerts & Channel Points", "Tier-specific alerts & custom Twitch rewards");
    await navigateWithCursor("chatAlerts", signal);
    await clickButtonByText(["Gifted"], signal, true);
    await sleep(550, signal);
    await clickButtonByText(["Engagement"], signal, true);
    beginZoom(1.24, 0.58, 0.46);
    await sleep(450, signal);
    await clickSelector('button[role="switch"]', signal, true);
    await sleep(350, signal);
    await clickSelector('button[role="switch"]', signal, true);
    await sleep(350, signal);
    endZoom();
    await navigateWithCursor("channelPoints", signal);
    await sleep(950, signal);

    // 8. Giveaways & Winner Roll + Reroll
    setStep(8, "Giveaways", "Live keyword entry tracking & instant winner draw");
    await navigateWithCursor("giveaways", signal);
    app.setGiveaway({
      running: true,
      keyword: "!win",
      chatAnnouncements: false,
      entries: [],
      winner: undefined,
    });
    await sleep(350, signal);
    for (let i = 0; i < 6; i++) {
      const entrant = pickUser(i);
      const msg = makeChat(entrant, "!win");
      app.pushChatMessage(msg);
      app.ingestGiveawayChatMessage(msg, "streamdash_bot");
      await sleep(220, signal);
    }
    await clickButtonByText(["Roll Winner"], signal, false);
    const entries = useAppStore.getState().giveaway.entries;
    if (entries.length > 0) {
      const winner = entries[2 % entries.length];
      app.setGiveaway({ running: false, winner });
      app.pushChatMessage(
        makeChat(
          {
            login: "streamdash_bot",
            displayName: "StreamDash Bot",
            color: "#a78bfa",
          },
          `Congratulations @${winner.displayName}! You won the giveaway!`,
        ),
      );
      toast.success(`Giveaway winner: ${winner.displayName}!`);
      beginZoom(1.28, 0.38, 0.48);
      await sleep(1100, signal);
      await clickButtonByText(["Reroll Winner"], signal, false);
      const rerolled = entries[4 % entries.length];
      app.setGiveaway({ running: false, winner: rerolled });
      toast.success(`Rerolled winner: ${rerolled.displayName}!`);
      await sleep(900, signal);
      endZoom();
    }

    // 9. OBS Control
    setStep(9, "OBS Studio Control", "Switch scenes, audio mixers & replay buffer");
    await navigateWithCursor("obs", signal);
    beginZoom(1.25, 0.56, 0.44);
    await clickButtonByText(["Gameplay"], signal, false);
    const obsSnap = useAppStore.getState().obsSnapshot;
    if (obsSnap) {
      app.setObsSnapshot({
        ...obsSnap,
        scene: "Gameplay",
        updatedAt: Date.now(),
      });
      toast.info("OBS Scene switched to Gameplay");
    }
    await sleep(450, signal);
    await clickSelector('button[aria-label*="Mute"]', signal, false);
    await sleep(450, signal);
    endZoom();

    // 10. Statistics & Goals
    setStep(10, "Statistics & Goals", "Track growth, revenue & community milestones");
    await navigateWithCursor("statistics", signal);
    await sleep(1050, signal);
    await navigateWithCursor("goals", signal);
    await sleep(1050, signal);

    // 11. Connections, Host & Settings (with sidebar + settings scroll)
    setStep(11, "Connections, Host & Settings", "Unified services, mobile companion & Pro Cloud Sync");
    await navigateWithCursor("connections", signal);
    await sleep(950, signal);
    await navigateWithCursor("host", signal);
    await sleep(950, signal);
    await navigateWithCursor("settings", signal);
    await clickButtonByText(["Appearance"], signal, true);
    await sleep(750, signal);
    const maxScroll = getMainMaxScroll();
    scrollMainSmooth(Math.round(maxScroll * 0.55));
    await sleep(900, signal);
    scrollMainSmooth(maxScroll);
    await sleep(900, signal);
    scrollMainSmooth(0);
    await sleep(550, signal);

    // 12. Finale back on Dashboard
    setStep(12, "StreamDash 2.1", "Built for streamers. Fast, local & reliable.");
    await navigateWithCursor("dashboard", signal);
    useDemoStore.setState((s) => ({
      cursor: { ...s.cursor, visible: false },
    }));
    await sleep(1600, signal);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  } finally {
    endZoom();
    if (abortController === controller) {
      abortController = null;
    }
    useDemoStore.setState({
      active: false,
      step: 0,
      title: "",
      subtitle: "",
      progress: 0,
      cursor: DEFAULT_CURSOR,
    });
    if (options?.autoSignal) {
      await notifyBridge("/done", { zooms: zoomSpans });
    }
  }
}
