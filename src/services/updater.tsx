import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { isTauri } from "../lib/utils";
import {
  UpdateContext,
  type UpdateChannel,
  type UpdateContextValue,
} from "./updater-context";
import { useTranslation } from "react-i18next";

type UpdateState = Omit<
  UpdateContextValue,
  "checkForUpdates" | "installUpdate"
>;
let automaticCheckStarted = false;
const STORE_UPDATES_URL = "ms-windows-store://downloadsandupdates";

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const updateRef = useRef<Update | null>(null);
  const channelRef = useRef<UpdateChannel | null>(
    import.meta.env.DEV ? "dev" : null,
  );
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    channel: import.meta.env.DEV ? "dev" : "standalone",
  });

  const resolveChannel = useCallback(async () => {
    if (channelRef.current) return channelRef.current;
    const channel = await invoke<"store" | "standalone">(
      "distribution_channel",
    );
    channelRef.current = channel;
    return channel;
  }, []);

  const checkForUpdates = useCallback(async (notifyWhenCurrent = true) => {
    if (!isTauri()) return;
    if (import.meta.env.DEV) {
      setState({ phase: "current", channel: "dev" });
      if (notifyWhenCurrent) toast.info(t("updater.disabledDevelopment"));
      return;
    }
    setState((current) => ({ ...current, phase: "checking" }));
    try {
      const channel = await resolveChannel();
      setState((current) => ({ ...current, channel }));
      if (channel === "store") {
        const available = await invoke<boolean>("store_update_available");
        setState({
          phase: available ? "available" : "current",
          channel: "store",
        });
        if (available) {
          toast.info(t("updater.storeAvailable"), {
            description: t("updater.storeAvailableDetail"),
            duration: 12_000,
          });
        } else if (notifyWhenCurrent) {
          toast.success(t("updater.current"));
        }
        return;
      }

      if (updateRef.current) await updateRef.current.close();
      const available = await check();
      updateRef.current = available;
      if (!available) {
        setState({ phase: "current", channel: "standalone" });
        if (notifyWhenCurrent) toast.success(t("updater.current"));
        return;
      }
      setState({
        phase: "available",
        channel: "standalone",
        version: available.version,
        currentVersion: available.currentVersion,
        notes: available.body,
      });
      toast.info(t("updater.available", { version: available.version }), {
        description: t("updater.availableDetail"),
        duration: 12_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({ ...current, phase: "error", error: message }));
      if (notifyWhenCurrent)
        toast.error(t("updater.checkError"), { description: message });
    }
  }, [resolveChannel, t]);

  const installUpdate = useCallback(async () => {
    if (channelRef.current === "store") {
      try {
        await openUrl(STORE_UPDATES_URL);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => ({ ...current, phase: "error", error: message }));
        toast.error(t("updater.storeOpenError"), { description: message });
      }
      return;
    }
    const available = updateRef.current;
    if (!available) return;
    let downloaded = 0;
    let total = 0;
    setState((current) => ({ ...current, phase: "downloading", progress: 0 }));
    try {
      await available.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setState((current) => ({
            ...current,
            phase: "downloading",
            progress: total
              ? Math.min(100, Math.round((downloaded / total) * 100))
              : undefined,
          }));
        }
        if (event.event === "Finished")
          setState((current) => ({
            ...current,
            phase: "installing",
            progress: 100,
          }));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((current) => ({ ...current, phase: "error", error: message }));
      toast.error(t("updater.installError"), { description: message });
    }
  }, [t]);

  useEffect(() => {
    if (!isTauri() || automaticCheckStarted) return;
    automaticCheckStarted = true;
    queueMicrotask(() => void checkForUpdates(false));
  }, [checkForUpdates]);

  useEffect(
    () => () => {
      if (updateRef.current) void updateRef.current.close();
    },
    [],
  );

  const value = useMemo(
    () => ({ ...state, checkForUpdates, installUpdate }),
    [state, checkForUpdates, installUpdate],
  );
  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}
