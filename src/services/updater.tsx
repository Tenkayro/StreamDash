import { check, type Update } from "@tauri-apps/plugin-updater";
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
import { UpdateContext, type UpdateContextValue } from "./updater-context";

type UpdateState = Omit<
  UpdateContextValue,
  "checkForUpdates" | "installUpdate"
>;
let automaticCheckStarted = false;

export function UpdateProvider({ children }: { children: ReactNode }) {
  const updateRef = useRef<Update | null>(null);
  const [state, setState] = useState<UpdateState>({ phase: "idle" });

  const checkForUpdates = useCallback(async (notifyWhenCurrent = true) => {
    if (!isTauri()) return;
    setState({ phase: "checking" });
    try {
      if (updateRef.current) await updateRef.current.close();
      const available = await check();
      updateRef.current = available;
      if (!available) {
        setState({ phase: "current" });
        if (notifyWhenCurrent) toast.success("StreamDash is up to date");
        return;
      }
      setState({
        phase: "available",
        version: available.version,
        currentVersion: available.currentVersion,
        notes: available.body,
      });
      toast.info(`StreamDash ${available.version} is available`, {
        description:
          "Use the download button beside the version in the title bar.",
        duration: 12_000,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ phase: "error", error: message });
      if (notifyWhenCurrent)
        toast.error("Could not check for updates", { description: message });
    }
  }, []);

  const installUpdate = useCallback(async () => {
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
      toast.error("Update installation failed", { description: message });
    }
  }, []);

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
