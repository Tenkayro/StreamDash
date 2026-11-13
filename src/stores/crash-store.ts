import { create } from "zustand";
import pkg from "../../package.json";
import { isTauri } from "../lib/utils";
import { useAppStore } from "./app-store";
import { isLikelyNetworkError, useNetworkStore } from "./network-store";

export type CrashKind = "react" | "runtime" | "promise" | "api";

export interface CrashReport {
  id: string;
  timestamp: string;
  kind: CrashKind;
  message: string;
  stack?: string;
  componentStack?: string;
  page?: string;
  fatal?: boolean;
}

interface CrashStore {
  activeCrash: CrashReport | null;
  history: CrashReport[];
  reportCrash: (input: Omit<CrashReport, "id" | "timestamp">) => void;
  dismissCrash: () => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 50;
let lastSignature = "";
let lastReportedAt = 0;
let handlersInstalled = false;

function shouldIgnoreError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("resizeobserver loop") ||
    lower.includes("script error.") ||
    lower.includes("aborterror")
  );
}

export function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || "Unknown error",
      stack: error.stack,
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export const useCrashStore = create<CrashStore>((set) => ({
  activeCrash: null,
  history: [],

  reportCrash: (input) => {
    const message = input.message.trim() || "Unexpected error";
    if (shouldIgnoreError(message)) return;

    const now = Date.now();
    const signature = `${input.kind}:${message}`;
    if (signature === lastSignature && now - lastReportedAt < 3000) {
      return;
    }
    lastSignature = signature;
    lastReportedAt = now;

    const entry: CrashReport = {
      ...input,
      message,
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(now).toISOString(),
    };

    set((state) => ({
      activeCrash: input.kind === "api" ? state.activeCrash : entry,
      history: [entry, ...state.history].slice(0, MAX_HISTORY),
    }));
  },

  dismissCrash: () => set({ activeCrash: null }),
  clearHistory: () => set({ history: [] }),
}));

export function formatCrashReport(report: CrashReport, history: CrashReport[]): string {
  const app = useAppStore.getState();
  const network = useNetworkStore.getState();
  const recentPages = app.pageHistory.slice(-5).join(" -> ");
  const viewport =
    typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "unknown";

  const lines = [
    `StreamDash Crash Report`,
    `Version: ${pkg.version} (Tauri: ${isTauri() ? "yes" : "no"})`,
    `Time: ${report.timestamp}`,
    `Kind: ${report.kind}${report.fatal ? " (fatal)" : ""}`,
    report.page ? `Page: ${report.page}` : undefined,
    recentPages ? `Recent Navigation: ${recentPages}` : undefined,
    `Language: ${app.settings.language} | Density: ${app.settings.uiDensity} | Viewport: ${viewport}`,
    `Network: ${network.online ? "online" : "offline"} | Pro: ${app.entitlements.pro ? "yes" : "no"} | Cloud: ${app.cloudSync.phase}`,
    `Connections: Twitch=${app.twitch.phase}, Bot=${app.twitchBot.phase}, OBS=${app.obs.phase}, SE=${app.streamElements.phase}, Tipeee=${app.tipeeStream.phase}`,
    `Platform: ${typeof navigator !== "undefined" ? navigator.userAgent : "unknown"}`,
    "",
    `Message: ${report.message}`,
  ].filter((line): line is string => line !== undefined);

  if (report.stack) {
    lines.push("", "Stack Trace:", report.stack);
  }
  if (report.componentStack) {
    lines.push("", "Component Stack:", report.componentStack.trim());
  }
  if (history.length > 1) {
    lines.push(
      "",
      "Recent Error Log:",
      ...history.slice(0, 10).map((item) => `[${item.timestamp}] (${item.kind}) ${item.message}`),
    );
  }
  return lines.join("\n");
}

export function installGlobalCrashHandlers(getPage?: () => string) {
  if (typeof window === "undefined" || handlersInstalled) return;
  handlersInstalled = true;

  window.addEventListener("error", (event) => {
    const raw = event.error ?? event.message;
    if (isLikelyNetworkError(raw)) {
      useNetworkStore.getState().reportNetworkError();
      return;
    }
    const { message, stack } = normalizeError(raw);
    useCrashStore.getState().reportCrash({
      kind: "runtime",
      message,
      stack: stack ?? (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined),
      page: getPage?.(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isLikelyNetworkError(event.reason)) {
      useNetworkStore.getState().reportNetworkError();
      return;
    }
    const { message, stack } = normalizeError(event.reason);
    useCrashStore.getState().reportCrash({
      kind: "promise",
      message,
      stack,
      page: getPage?.(),
    });
  });
}
