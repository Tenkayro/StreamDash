import { TwitchPlayer } from "../components/TwitchPlayer";
import { PageHeader } from "../components/ui";

export function LivePreview() {
  return (
    <>
      <PageHeader title="Live Preview" />
      <div className="overflow-hidden rounded-xl border border-line bg-black shadow-2xl shadow-black/20">
        <TwitchPlayer className="aspect-video h-auto w-full" />
      </div>
    </>
  );
}
