import { createContext, useContext } from "react";
import type {
  ChatUserProfile,
  ProEntitlements,
  ProfileExportBundle,
  ProfileExportSections,
  StorageTicketState,
  SupportTicketState,
} from "../types";

export interface DeviceAuth {
  code: string;
  url: string;
  expiresAt: number;
}
export interface CreateProfileOptions {
  name: string;
  template: "copy" | "clean";
  linkCurrentTwitch?: boolean;
}
export interface ExportProfileOptions {
  scope: "profile" | "all";
  targetProfileId?: string;
  included: ProfileExportSections;
  mode: "file" | "clipboard";
}
export interface ImportProfileOptions {
  mode: "new" | "overwrite" | "merge" | "replace_all";
  profileName?: string;
  activateAfterImport?: boolean;
  linkCurrentTwitch?: boolean;
  mergeCollections?: boolean;
  sections: ProfileExportSections;
}
export interface RuntimeValue {
  deviceAuth?: DeviceAuth;
  botDeviceAuth?: DeviceAuth;
  connectTwitch: () => Promise<void>;
  disconnectTwitch: () => Promise<void>;
  reauthorizeTwitch: () => Promise<void>;
  connectTwitchBot: () => Promise<void>;
  disconnectTwitchBot: () => Promise<void>;
  reauthorizeTwitchBot: () => Promise<void>;
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
  setObsStreaming: (active: boolean) => Promise<void>;
  setObsRecording: (active: boolean) => Promise<void>;
  setObsRecordingPaused: (paused: boolean) => Promise<void>;
  setObsReplayBuffer: (active: boolean) => Promise<void>;
  saveObsReplayBuffer: () => Promise<void>;
  setObsVirtualCam: (active: boolean) => Promise<void>;
  sendChatMessage: (text: string) => Promise<void>;
  sendBotChatMessage: (text: string, replyParentId?: string) => Promise<void>;
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
  switchProfile: (profileId: string) => Promise<void>;
  createProfile: (options: CreateProfileOptions) => Promise<string>;
  renameProfile: (profileId: string, name: string) => Promise<void>;
  duplicateProfile: (profileId: string) => Promise<string>;
  deleteProfile: (profileId: string) => Promise<void>;
  linkProfileToTwitch: (profileId: string, link: boolean) => Promise<void>;
  setProfilesAutoSwitch: (enabled: boolean) => Promise<void>;
  exportProfiles: (
    options: ExportProfileOptions,
  ) => Promise<"saved" | "copied" | "cancelled">;
  importProfiles: (
    bundle: ProfileExportBundle,
    options: ImportProfileOptions,
  ) => Promise<void>;
  setCloudSyncEnabled: (enabled: boolean) => Promise<void>;
  syncCloudNow: (
    mode?: "smart" | "push" | "pull",
    options?: { force?: boolean; merge?: boolean },
  ) => Promise<void>;
  deleteCloudBackup: () => Promise<void>;
  refreshProEntitlements: () => Promise<ProEntitlements>;
  activateProLicense: (licenseKey: string) => Promise<ProEntitlements>;
  refreshSupportTicket: (force?: boolean) => Promise<SupportTicketState | undefined>;
  submitKeyResetTicket: (message: string) => Promise<void>;
  refreshStorageTicket: (force?: boolean) => Promise<StorageTicketState | undefined>;
  submitStorageRequestTicket: (requestedMb: number, message: string) => Promise<void>;
  reconnect: () => Promise<void>;
  shutdown: () => Promise<void>;
}
export const RuntimeContext = createContext<RuntimeValue | null>(null);
export const useRuntime = () => {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("RuntimeProvider is missing");
  return runtime;
};
