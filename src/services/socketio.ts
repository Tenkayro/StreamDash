import io, { type Socket } from "socket.io-client";

type SocketState = "connected" | "reconnecting" | "error";

export class LegacySocketIoClient {
  private socket?: Socket;
  private stopped = false;

  private readonly url: string;
  private readonly onConnected: (emit: (event: string, payload: unknown) => void) => void;
  private readonly onEvent: (event: string, payload: unknown) => void;
  private readonly onState: (state: SocketState, detail?: string) => void;

  constructor(
    url: string,
    onConnected: (emit: (event: string, payload: unknown) => void) => void,
    onEvent: (event: string, payload: unknown) => void,
    onState: (state: SocketState, detail?: string) => void,
  ) {
    this.url = url;
    this.onConnected = onConnected;
    this.onEvent = onEvent;
    this.onState = onState;
  }

  start() {
    this.stop();
    this.stopped = false;
    const socket = io(this.url, {
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      if (this.stopped || this.socket !== socket) return;
      this.onState("connected");
      this.onConnected((event, payload) => socket.emit(event, payload));
    });
    for (const event of ["event", "new-event"]) {
      socket.on(event, (payload: unknown) => this.onEvent(event, payload));
    }
    socket.on("disconnect", () => {
      if (!this.stopped && this.socket === socket) this.onState("reconnecting");
    });
    socket.on("reconnect_attempt", () => {
      if (!this.stopped && this.socket === socket) this.onState("reconnecting");
    });
    socket.on("reconnect_failed", () => {
      if (!this.stopped && this.socket === socket) this.onState("error");
    });
    socket.on("connect_error", () => {
      if (!this.stopped && this.socket === socket) this.onState("reconnecting");
    });
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.socket = undefined;
  }
}
