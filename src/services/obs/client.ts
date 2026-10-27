import type {
  ConnectionPhase,
  ObsAudioInput,
  ObsInputKind,
  ObsSnapshot,
} from "../../types";

type Json = Record<string, unknown>;
type Translator = (key: string) => string;

const OP_HELLO = 0;
const OP_IDENTIFY = 1;
const OP_IDENTIFIED = 2;
const OP_EVENT = 5;
const OP_REQUEST = 6;
const OP_REQUEST_RESPONSE = 7;

/** General, Config, Scenes, Inputs and Outputs events. */
const EVENT_SUBSCRIPTIONS = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 6);

const POLL_INTERVAL = 2_000;
const REQUEST_TIMEOUT = 10_000;
const CONNECT_TIMEOUT = 12_000;
const LIVENESS_TIMEOUT = 18_000;
const MAX_RECONNECT_DELAY = 30_000;

export const DEFAULT_OBS_ADDRESS = "127.0.0.1:4455";

type Options = {
  address: string;
  password?: string;
  translate: Translator;
  onSnapshot: (snapshot: ObsSnapshot) => void;
  onState: (phase: ConnectionPhase, detail?: string) => void;
};

function normaliseAddress(input: string) {
  let value = input.trim() || DEFAULT_OBS_ADDRESS;
  value = value.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  if (!/^wss?:\/\//i.test(value)) value = `ws://${value}`;
  const url = new URL(value);
  if (!url.port) url.port = "4455";
  return url.toString();
}

async function sha256Base64(value: string) {
  if (!globalThis.crypto?.subtle)
    throw new Error("SubtleCrypto is unavailable");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function authenticationToken(
  password: string,
  salt: string,
  challenge: string,
) {
  const secret = await sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

function emptySnapshot(): ObsSnapshot {
  return {
    scenes: [],
    streaming: false,
    streamSeconds: 0,
    recording: false,
    recordingPaused: false,
    recordingSeconds: 0,
    replayBuffer: false,
    virtualCam: false,
    audio: [],
    updatedAt: Date.now(),
  };
}

type PendingRequest = {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ObsClient {
  private readonly options: Options;
  private socket?: WebSocket;
  private stopped = false;
  private identified = false;
  private everIdentified = false;
  private attempts = 0;
  private polling = false;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private lastBytes?: { bytes: number; at: number };
  private lastResponseAt = 0;
  private snapshot: ObsSnapshot = emptySnapshot();

  constructor(options: Options) {
    this.options = options;
  }

  start() {
    this.stopped = false;
    this.attempts = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.cleanup();
  }

  async setScene(sceneName: string) {
    await this.request("SetCurrentProgramScene", { sceneName });
    this.snapshot.scene = sceneName;
    this.emit();
  }

  async setMute(inputName: string, muted: boolean) {
    await this.request("SetInputMute", { inputName, inputMuted: muted });
    this.updateAudio(inputName, (input) => {
      input.muted = muted;
    });
  }

  async setVolume(inputName: string, volume: number) {
    const value = Math.max(0, Math.min(1, volume));
    await this.request("SetInputVolume", {
      inputName,
      inputVolumeMul: value,
    });
    this.updateAudio(inputName, (input) => {
      input.volume = value;
      input.volumeDb = value > 0 ? 20 * Math.log10(value) : -100;
    });
  }

  private connect() {
    if (this.stopped) return;
    if (!this.everIdentified && this.attempts === 0)
      this.options.onState("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(normaliseAddress(this.options.address));
    } catch {
      this.options.onState("error", this.options.translate("obs.errors.unreachable"));
      this.attempts += 1;
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      void this.handleMessage(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.handleClose(event.code);
    };
    socket.onerror = () => {
      /* handled by onclose */
    };
    this.connectTimer = setTimeout(() => {
      if (this.socket !== socket || this.identified) return;
      try {
        socket.close();
      } catch {
        this.handleClose();
      }
    }, CONNECT_TIMEOUT);
  }

  private cleanup() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.connectTimer = undefined;
    this.reconnectTimer = undefined;
    this.pollTimer = undefined;
    this.identified = false;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    }
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("OBS connection closed"));
      this.pending.delete(id);
    }
  }

  private handleClose(code?: number) {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    const wasIdentified = this.identified;
    this.identified = false;
    this.stopPolling();
    this.socket = undefined;
    this.rejectPending("OBS connection lost");
    if (this.stopped) return;
    if (code === 4009 || code === 4008) {
      this.fail(this.options.translate("obs.errors.password"));
      return;
    }
    this.attempts += 1;
    this.options.onState(
      wasIdentified || this.everIdentified ? "reconnecting" : "error",
      this.options.translate("obs.errors.unreachable"),
    );
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      MAX_RECONNECT_DELAY,
      1_000 * 2 ** Math.min(5, Math.max(0, this.attempts - 1)),
    );
    const jitteredDelay = delay + Math.random() * Math.min(1_000, delay / 4);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, jitteredDelay);
  }

  private async handleMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let message: { op?: number; d?: Json };
    try {
      message = JSON.parse(raw) as { op?: number; d?: Json };
    } catch {
      return;
    }
    const data = (message.d ?? {}) as Json;
    switch (message.op) {
      case OP_HELLO:
        await this.identify(data);
        break;
      case OP_IDENTIFIED:
        this.handleIdentified();
        break;
      case OP_EVENT:
        this.handleEvent(
          String(data.eventType ?? ""),
          (data.eventData ?? {}) as Json,
        );
        break;
      case OP_REQUEST_RESPONSE:
        this.handleResponse(data);
        break;
      default:
        break;
    }
  }

  private async identify(hello: Json) {
    const authentication = hello.authentication as
      | { challenge?: string; salt?: string }
      | undefined;
    const payload: Json = {
      rpcVersion: 1,
      eventSubscriptions: EVENT_SUBSCRIPTIONS,
    };
    if (authentication?.challenge && authentication.salt) {
      if (!this.options.password) {
        this.fail(this.options.translate("obs.errors.authRequired"));
        return;
      }
      try {
        payload.authentication = await authenticationToken(
          this.options.password,
          authentication.salt,
          authentication.challenge,
        );
      } catch {
        this.fail(this.options.translate("obs.errors.crypto"));
        return;
      }
    }
    this.send({ op: OP_IDENTIFY, d: payload });
  }

  private fail(detail: string) {
    this.stopped = true;
    this.cleanup();
    this.options.onState("error", detail);
  }

  private handleIdentified() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
    this.identified = true;
    this.everIdentified = true;
    this.attempts = 0;
    this.lastResponseAt = Date.now();
    this.options.onState("connected");
    void this.bootstrap();
    this.startPolling();
  }

  private startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL);
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  private async bootstrap() {
    const [version, scenes, profile, specials, stream, record, replay, cam] =
      await Promise.all([
        this.request("GetVersion").catch(() => undefined),
        this.request("GetSceneList").catch(() => undefined),
        this.request("GetProfileList").catch(() => undefined),
        this.request("GetSpecialInputs").catch(() => undefined),
        this.request("GetStreamStatus").catch(() => undefined),
        this.request("GetRecordStatus").catch(() => undefined),
        this.request("GetReplayBufferStatus").catch(() => undefined),
        this.request("GetVirtualCamStatus").catch(() => undefined),
      ]);
    if (version) this.snapshot.version = String(version.obsVersion ?? "");
    if (scenes) this.applyScenes(scenes);
    if (profile) {
      this.snapshot.profile = String(profile.currentProfileName ?? "");
      this.snapshot.sceneCollection = String(
        profile.currentSceneCollectionName ?? "",
      );
    }
    if (stream) {
      this.applyStream(stream);
      const bytes = Number(stream.outputBytes ?? 0);
      if (this.snapshot.streaming && bytes > 0)
        this.lastBytes = { bytes, at: performance.now() };
    }
    if (record) this.applyRecord(record);
    if (replay) this.snapshot.replayBuffer = Boolean(replay.outputActive);
    if (cam) this.snapshot.virtualCam = Boolean(cam.outputActive);
    const audio = await Promise.all([
      this.loadAudioInput(specials?.mic1, "mic"),
      this.loadAudioInput(specials?.mic2, "mic"),
      this.loadAudioInput(specials?.desktop1, "desktop"),
    ]);
    this.snapshot.audio = audio.filter(
      (input): input is ObsAudioInput => input != null,
    );
    if (this.identified) {
      await this.refreshStats();
      this.emit();
    }
  }

  private async loadAudioInput(
    name: unknown,
    kind: ObsInputKind,
  ): Promise<ObsAudioInput | undefined> {
    if (typeof name !== "string" || !name) return undefined;
    try {
      const [mute, volume] = await Promise.all([
        this.request("GetInputMute", { inputName: name }),
        this.request("GetInputVolume", { inputName: name }),
      ]);
      return {
        name,
        kind,
        muted: Boolean(mute.inputMuted),
        volume: Number(volume.inputVolumeMul ?? 1),
        volumeDb: Number(volume.inputVolumeDb ?? 0),
      };
    } catch {
      return undefined;
    }
  }

  private applyScenes(data: Json) {
    const scenes = Array.isArray(data.scenes) ? data.scenes : [];
    this.snapshot.scenes = scenes
      .map((entry) => String((entry as Json).sceneName ?? ""))
      .filter(Boolean)
      .reverse();
    const current = String(data.currentProgramSceneName ?? "");
    if (current) this.snapshot.scene = current;
  }

  private applyStream(data: Json) {
    const streaming = Boolean(data.outputActive);
    this.snapshot.streaming = streaming;
    this.snapshot.streamSeconds = Math.floor(
      Number(data.outputDuration ?? 0) / 1000,
    );
    this.snapshot.streamDropped = Number(data.outputSkippedFrames ?? 0);
    if (!streaming) {
      this.snapshot.streamBitrate = undefined;
      this.lastBytes = undefined;
    }
  }

  private applyRecord(data: Json) {
    this.snapshot.recording = Boolean(data.outputActive);
    this.snapshot.recordingPaused = Boolean(data.outputPaused);
    this.snapshot.recordingSeconds = Math.floor(
      Number(data.outputDuration ?? 0) / 1000,
    );
  }

  private async refreshStream() {
    const data = await this.request("GetStreamStatus").catch(() => undefined);
    if (!data) return;
    const now = performance.now();
    const bytes = Number(data.outputBytes ?? 0);
    this.applyStream(data);
    if (this.snapshot.streaming) {
      if (this.lastBytes && bytes > this.lastBytes.bytes) {
        const seconds = (now - this.lastBytes.at) / 1000;
        if (seconds > 0.25)
          this.snapshot.streamBitrate = Math.round(
            ((bytes - this.lastBytes.bytes) * 8) / 1000 / seconds,
          );
      }
      this.lastBytes = { bytes, at: now };
    }
    this.emit();
  }

  private async refreshRecord() {
    const data = await this.request("GetRecordStatus").catch(() => undefined);
    if (!data) return;
    this.applyRecord(data);
    this.emit();
  }

  private async refreshStats() {
    const data = await this.request("GetStats").catch(() => undefined);
    if (!data) return;
    this.snapshot.fps = Number(data.activeFps ?? 0) || undefined;
    this.snapshot.cpu = Number(data.cpuUsage ?? 0) || undefined;
    this.emit();
  }

  private async refreshScenes() {
    const data = await this.request("GetSceneList").catch(() => undefined);
    if (!data) return;
    this.applyScenes(data);
    this.emit();
  }

  private async poll() {
    if (!this.identified || this.polling) return;
    this.polling = true;
    try {
      await Promise.all([
        this.refreshStream(),
        this.refreshRecord(),
        this.refreshStats(),
      ]);
    } finally {
      this.polling = false;
      if (
        this.identified &&
        this.lastResponseAt > 0 &&
        Date.now() - this.lastResponseAt > LIVENESS_TIMEOUT
      ) {
        this.options.onState(
          "reconnecting",
          this.options.translate("obs.errors.unreachable"),
        );
        this.socket?.close();
      }
    }
  }

  private handleEvent(eventType: string, data: Json) {
    switch (eventType) {
      case "CurrentProgramSceneChanged":
        if (typeof data.sceneName === "string") {
          this.snapshot.scene = data.sceneName;
          this.emit();
        }
        break;
      case "SceneListChanged":
        void this.refreshScenes();
        break;
      case "StreamStateChanged":
        void this.refreshStream();
        break;
      case "RecordStateChanged":
        void this.refreshRecord();
        break;
      case "ReplayBufferStateChanged":
        this.snapshot.replayBuffer = Boolean(data.outputActive);
        this.emit();
        break;
      case "VirtualcamStateChanged":
        this.snapshot.virtualCam = Boolean(data.outputActive);
        this.emit();
        break;
      case "InputMuteStateChanged":
        this.updateAudio(String(data.inputName ?? ""), (input) => {
          input.muted = Boolean(data.inputMuted);
        });
        break;
      case "InputVolumeChanged":
        this.updateAudio(String(data.inputName ?? ""), (input) => {
          input.volume = Number(data.inputVolumeMul ?? input.volume);
          input.volumeDb = Number(data.inputVolumeDb ?? input.volumeDb);
        });
        break;
      case "ExitStarted":
        // OBS is shutting down. Keep retrying so StreamDash reconnects on its
        // own as soon as OBS is started again.
        this.identified = false;
        this.attempts = Math.max(1, this.attempts);
        this.cleanup();
        this.options.onState(
          "reconnecting",
          this.options.translate("obs.errors.exited"),
        );
        this.scheduleReconnect();
        break;
      default:
        break;
    }
  }

  private updateAudio(
    name: string,
    mutate: (input: ObsAudioInput) => void,
  ) {
    const input = this.snapshot.audio.find((entry) => entry.name === name);
    if (!input) return;
    mutate(input);
    this.emit();
  }

  private emit() {
    this.snapshot.updatedAt = Date.now();
    this.options.onSnapshot({
      ...this.snapshot,
      scenes: [...this.snapshot.scenes],
      audio: this.snapshot.audio.map((input) => ({ ...input })),
    });
  }

  private send(payload: Json) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(payload));
  }

  private request(requestType: string, requestData?: Json): Promise<Json> {
    if (!this.socket || !this.identified)
      return Promise.reject(new Error("OBS is not connected"));
    const requestId = String(this.requestCounter++);
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS request timed out: ${requestType}`));
      }, REQUEST_TIMEOUT);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({
        op: OP_REQUEST,
        d: { requestType, requestId, requestData },
      });
    });
  }

  private handleResponse(data: Json) {
    const requestId = String(data.requestId ?? "");
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    this.lastResponseAt = Date.now();
    const status = (data.requestStatus ?? {}) as Json;
    const code = Number(status.code ?? 100);
    if (code !== 100) {
      entry.reject(
        new Error(String(status.comment ?? `OBS error ${code}`)),
      );
      return;
    }
    entry.resolve((data.responseData ?? {}) as Json);
  }

  private rejectPending(reason: string) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
