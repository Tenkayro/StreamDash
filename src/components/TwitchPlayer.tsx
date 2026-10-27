import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { cn } from "../lib/utils";

const FALLBACK_CHANNEL = "tenkayro";

function playerUrl(channel: string) {
  const url = new URL("https://player.twitch.tv/");
  url.searchParams.set("channel", channel);
  url.searchParams.set("parent", window.location.hostname || "localhost");
  url.searchParams.set("autoplay", "false");
  url.searchParams.set("muted", "true");
  return url.toString();
}

export function TwitchPlayer({ className }: { className?: string }) {
  const { t } = useTranslation();
  const account = useAppStore((state) => state.twitch.account);
  const channel = account || FALLBACK_CHANNEL;
  const src = useMemo(() => playerUrl(channel), [channel]);

  return (
    <iframe
      key={src}
      src={src}
      title={t("stream.playerTitle", { channel })}
      allow="autoplay; fullscreen"
      allowFullScreen
      className={cn("block min-h-[300px] min-w-[400px] border-0", className)}
    />
  );
}
