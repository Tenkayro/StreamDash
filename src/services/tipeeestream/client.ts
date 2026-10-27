import type { ActivityEvent } from "../../types";
import { LegacySocketIoClient } from "../socketio";

type Json = Record<string, unknown>;

export class TipeeeStreamClient {
  private readonly apiKey: string;
  private readonly onEvent: (event: ActivityEvent) => void;
  private readonly onState: (state: "connected" | "reconnecting" | "error", detail?: string) => void;
  private socket?: LegacySocketIoClient;
  private stopped = false;

  constructor(
    apiKey: string,
    onEvent: (event: ActivityEvent) => void,
    onState: (state: "connected" | "reconnecting" | "error", detail?: string) => void,
  ) {
    this.apiKey = apiKey;
    this.onEvent = onEvent;
    this.onState = onState;
  }

  async start() {
    this.stopped = false;
    try {
      const [siteResponse, userResponse] = await Promise.all([
        fetch("https://api.tipeeestream.com/v2.0/site/socket"),
        fetch(`https://api.tipeeestream.com/v1.0/me.json?apiKey=${encodeURIComponent(this.apiKey)}`),
      ]);
      if (!siteResponse.ok || !userResponse.ok) throw new Error();
      const site = (await siteResponse.json()) as Json;
      const user = (await userResponse.json()) as Json;
      const socketData = site.datas as Json;
      const host = String(socketData?.host ?? "");
      const port = String(socketData?.port ?? "443");
      const username = String(user.username ?? "");
      if (!host || !username) throw new Error();
      const socketUrl = `${host.replace(/\/$/, "")}:${port}?access_token=${encodeURIComponent(this.apiKey)}`;
      if (this.stopped) return;
      this.socket = new LegacySocketIoClient(
        socketUrl,
        (emit) => emit("join-room", { room: this.apiKey, username }),
        (name, payload) => {
          if (name !== "new-event") return;
          const event = normalizeTipeeeStream(payload);
          if (event) this.onEvent(event);
        },
        this.onState,
      );
      this.socket.start();
    } catch {
      this.onState("error");
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
