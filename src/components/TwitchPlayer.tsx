import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../stores/app-store";
import { cn } from "../lib/utils";
import { Button, EmptyState } from "./ui";
import { MonitorOff } from "lucide-react";

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
  const setPage = useAppStore((state) => state.setPage);
  const src = useMemo(() => (account ? playerUrl(account) : ""), [account]);

  if (!account)
    return (
      <div className={cn("grid min-h-64 place-items-center bg-panel", className)}>
        <EmptyState
          icon={<MonitorOff size={22} />}
          title={t("livePreview.notConnected")}
          body={t("livePreview.notConnectedDetail")}
          action={
            <Button variant="primary" onClick={() => setPage("connections")}>
              {t("chat.openConnections")}
            </Button>
          }
        />
      </div>
    );

  return (
    <iframe
      key={src}
      src={src}
      title={t("stream.playerTitle", { channel: account })}
      allow="autoplay; fullscreen"
      allowFullScreen
      className={cn("block min-h-52 min-w-0 border-0 sm:min-h-[300px]", className)}
    />
  );
}
