import { createContext, useContext } from "react";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "error";

export type UpdateChannel = "beta" | "dev" | "standalone" | "store";

export interface UpdateContextValue {
  phase: UpdatePhase;
  channel: UpdateChannel;
  version?: string;
  currentVersion?: string;
  notes?: string;
  progress?: number;
  error?: string;
  checkForUpdates: (notifyWhenCurrent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
}

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdater() {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useUpdater must be used inside UpdateProvider");
  return value;
}
