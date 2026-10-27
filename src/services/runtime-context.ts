import { createContext, useContext } from "react";
import type { ChatUserProfile } from "../types";

export interface DeviceAuth {
  code: string;
  url: string;
  expiresAt: number;
}
export interface RuntimeValue {
  deviceAuth?: DeviceAuth;
  connectTwitch: () => Promise<void>;
  disconnectTwitch: () => Promise<void>;
  reauthorizeTwitch: () => Promise<void>;
  connectStreamElements: (token: string) => Promise<void>;
  retryStreamElements: () => Promise<void>;
  disconnectStreamElements: () => Promise<void>;
  connectTipeeeStream: (apiKey: string) => Promise<void>;
  retryTipeeeStream: () => Promise<void>;
  disconnectTipeeeStream: () => Promise<void>;
  connectObs: (address: string, password: string) => Promise<void>;
  retryObs: () => Promise<void>;
  disconnectObs: () => Promise<void>;
  setObsScene: (scene: string) => Promise<void>;
  setObsMute: (input: string, muted: boolean) => Promise<void>;
  setObsVolume: (input: string, volume: number) => Promise<void>;
  sendChatMessage: (text: string) => Promise<void>;
  getChatUserProfile: (login: string) => Promise<ChatUserProfile>;
  moderateChatUser: (
    userId: string,
    duration?: number,
    reason?: string,
  ) => Promise<void>;
  unbanChatUser: (userId: string) => Promise<void>;
  deleteChatMessage: (messageId: string) => Promise<void>;
  setChatUserRole: (
    userId: string,
    role: "moderator" | "vip",
    enabled: boolean,
  ) => Promise<void>;
  reconnect: () => Promise<void>;
  shutdown: () => Promise<void>;
}
export const RuntimeContext = createContext<RuntimeValue | null>(null);
export const useRuntime = () => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("RuntimeProvider is missing");
  return runtime;
};
