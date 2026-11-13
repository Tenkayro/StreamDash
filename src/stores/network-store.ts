import { create } from "zustand";

interface NetworkStore {
  online: boolean;
  checking: boolean;
  lastCheckedAt: number | null;
  checkNow: () => Promise<boolean>;
  reportNetworkError: () => void;
  reportNetworkSuccess: () => void;
}

const PROBE_URLS = [
  "https://streamdash-api.tenkayro.de/health",
  "https://api.twitch.tv/helix",
];

let probeInFlight: Promise<boolean> | null = null;
let monitorStarted = false;
let offlinePollTimer: number | null = null;

async function probeConnectivity(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }

  for (const url of PROBE_URLS) {
    try {
      await fetch(url, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      return true;
    } catch {
      // Try next endpoint before concluding offline.
    }
  }

  return false;
}

function scheduleOfflinePoll() {
  if (typeof window === "undefined" || offlinePollTimer !== null) return;
  offlinePollTimer = window.setInterval(() => {
    if (useNetworkStore.getState().online) {
      clearOfflinePoll();
      return;
    }
    void useNetworkStore.getState().checkNow();
  }, 10_000);
}

function clearOfflinePoll() {
  if (typeof window === "undefined" || offlinePollTimer === null) return;
  window.clearInterval(offlinePollTimer);
  offlinePollTimer = null;
}

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  checking: false,
  lastCheckedAt: null,

  checkNow: async () => {
    if (probeInFlight) return probeInFlight;
    set({ checking: true });

    probeInFlight = probeConnectivity()
      .then((reachable) => {
        set({
          online: reachable,
          checking: false,
          lastCheckedAt: Date.now(),
        });
        if (reachable) {
          clearOfflinePoll();
        } else {
          scheduleOfflinePoll();
        }
        return reachable;
      })
      .finally(() => {
        probeInFlight = null;
      });

    return probeInFlight;
  },

  reportNetworkError: () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      set({ online: false, lastCheckedAt: Date.now() });
      scheduleOfflinePoll();
      return;
    }
    if (!get().checking) {
      void get().checkNow();
    }
  },

  reportNetworkSuccess: () => {
    if (!get().online) {
      set({ online: true, lastCheckedAt: Date.now() });
      clearOfflinePoll();
    }
  },
}));

export function startNetworkMonitoring() {
  if (typeof window === "undefined" || monitorStarted) return;
  monitorStarted = true;

  const handleOffline = () => {
    useNetworkStore.setState({ online: false, lastCheckedAt: Date.now() });
    scheduleOfflinePoll();
  };

  const handleOnline = () => {
    void useNetworkStore.getState().checkNow();
  };

  window.addEventListener("offline", handleOffline);
  window.addEventListener("online", handleOnline);

  if (!navigator.onLine) {
    handleOffline();
  } else {
    void useNetworkStore.getState().checkNow();
  }
}

export function isLikelyNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    error.name === "AbortError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("err_internet_disconnected") ||
    msg.includes("err_name_not_resolved") ||
    msg.includes("timeout")
  );
}
