import type { ActivityEvent } from "../../types";
import { LegacySocketIoClient } from "../socketio";

type Json = Record<string, unknown>;
type Translator = (key: string, options?: Record<string, unknown>) => string;

export class TipeeeStreamClient {
  private readonly apiKey: string;
  private readonly onEvent: (event: ActivityEvent) => void;
  private readonly onState: (state: "connected" | "reconnecting" | "error", detail?: string) => void;
  private readonly translate: Translator;
  private socket?: LegacySocketIoClient;
  private stopped = false;

  constructor(
    apiKey: string,
    onEvent: (event: ActivityEvent) => void,
    onState: (state: "connected" | "reconnecting" | "error", detail?: string) => void,
    translate: Translator,
  ) {
    this.apiKey = apiKey;
    this.onEvent = onEvent;
    this.onState = onState;
    this.translate = translate;
  }

  async start() {
    this.stopped = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const [siteResponse, userResponse] = await Promise.all([
        fetch("https://api.tipeeestream.com/v2.0/site/socket", {
          signal: controller.signal,
        }),
        fetch(`https://api.tipeeestream.com/v1.0/me.json?apiKey=${encodeURIComponent(this.apiKey)}`, {
          signal: controller.signal,
        }),
      ]);
      if (!siteResponse.ok)
        throw new Error(this.translate("connections.tipeeeSocketDiscoveryError", { status: siteResponse.status }));
      if (!userResponse.ok)
        throw new Error(this.translate("connections.tipeeeApiKeyRejected", { status: userResponse.status }));
      const site = (await siteResponse.json()) as Json;
      const user = (await userResponse.json()) as Json;
      const socketData = site.datas as Json;
      const host = String(socketData?.host ?? "");
      const port = String(socketData?.port ?? "443");
      const username = String(user.username ?? "");
      if (!host || !username)
        throw new Error(this.translate("connections.tipeeeIncompleteResponse"));
      const socketUrl = `${host.replace(/\/$/, "")}:${port}`;
      if (this.stopped) return;
      this.socket = new LegacySocketIoClient(
        socketUrl,
        (emit) => emit("join-room", { room: this.apiKey, username }),
        (name, payload) => {
          if (name !== "new-event") return;
          const event = normalizeTipeeeStream(payload);
          if (event) this.onEvent(event);
        },
        (phase, detail) =>
          this.onState(
            phase,
            detail ??
              (phase === "error"
                ? this.translate("connections.tipeeeRealtimeError")
                : undefined),
          ),
        { access_token: this.apiKey },
      );
      this.socket.start();
    } catch (error) {
      const detail =
        error instanceof DOMException && error.name === "AbortError"
          ? this.translate("connections.tipeeeTimeout")
          : error instanceof Error
            ? error.message
            : String(error);
      this.onState("error", detail);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  stop() {
    this.stopped = true;
    this.socket?.stop();
    this.socket = undefined;
  }
}

function normalizeTipeeeStream(payload: unknown): ActivityEvent | null {
  const envelope = payload as Json;
  const event = (envelope?.event ?? envelope) as Json;
  if (event?.type !== "donation") return null;
  const parameters = (event.parameters ?? {}) as Json;
  const user = (event.user ?? {}) as Json;
  const username = String(parameters.username ?? user.username ?? "");
  return {
    id: `tipeeestream:${event.id ?? event.ref ?? Date.now()}`,
    source: "tipeeestream",
    eventType: "donation",
    username,
    displayName: username,
    timestamp: String(event.created_at ?? event.inserted_at ?? new Date().toISOString()),
    amount: Number(parameters.amount ?? event["parameters.amount"] ?? 0),
    currency: parameters.currency ? String(parameters.currency) : undefined,
    message: parameters.message ? String(parameters.message) : undefined,
    metadata: { provider: "tipeeestream" },
  };
}
