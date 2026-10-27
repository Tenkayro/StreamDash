import { TwitchPlayer } from "../components/TwitchPlayer";
import { PageHeader } from "../components/ui";
import { useTranslation } from "react-i18next";
import { MonitorPlay } from "lucide-react";

export function LivePreview() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader icon={MonitorPlay} title={t("nav.livePreview")} />
      <div className="overflow-hidden rounded-xl border border-line bg-black shadow-2xl shadow-black/20">
        <TwitchPlayer className="aspect-video h-auto w-full" />
      </div>
    </>
  );
}
